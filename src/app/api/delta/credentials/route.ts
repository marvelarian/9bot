export const runtime = 'nodejs';

import { deltaFetch } from '@/lib/delta-signing';
import { readAllDeltaCredentials, readDeltaCredentials, writeDeltaCredentials, type DeltaExchangeId } from '@/lib/delta-credentials-store';
import { clearDeltaCredentials } from '@/lib/delta-credentials-store';
import { appendDeltaLog } from '@/lib/server-log';

function maskKey(k: string) {
  if (k.length <= 8) return '********';
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

function parseCookie(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function GET(req: Request) {
  const fromEnv = !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
  const all = await readAllDeltaCredentials();
  const profiles = all?.profiles || {};
  const storedActive = all?.active || undefined;

  const { searchParams } = new URL(req.url);
  const qExchange = searchParams.get('exchange') || undefined;
  const cookieExchange = parseCookie(req.headers.get('cookie')).exchange;
  const exchange = (qExchange || cookieExchange || storedActive) as DeltaExchangeId | undefined;

  const configuredAny = fromEnv || Object.values(profiles).some((p) => p && (p as any).apiKey && (p as any).apiSecret);

  if (exchange) {
    const stored = await readDeltaCredentials(exchange);
    const baseUrl = process.env.DELTA_BASE_URL || stored?.baseUrl || 'https://api.delta.exchange';
    return Response.json({
      ok: true,
      exchange,
      configured: fromEnv || !!stored,
      source: fromEnv ? 'env' : stored ? 'store' : 'none',
      baseUrl,
      apiKeyMasked: fromEnv ? maskKey(process.env.DELTA_API_KEY!) : stored ? maskKey(stored.apiKey) : null,
      updatedAt: stored?.updatedAt || null,
      active: storedActive || null,
      profiles: Object.fromEntries(
        Object.entries(profiles).map(([k, v]) => [
          k,
          v
            ? { baseUrl: (v as any).baseUrl, apiKeyMasked: maskKey((v as any).apiKey), updatedAt: (v as any).updatedAt }
            : null,
        ])
      ),
    });
  }

  return Response.json({
    ok: true,
    configured: configuredAny,
    active: storedActive || null,
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([k, v]) => [
        k,
        v
          ? { baseUrl: (v as any).baseUrl, apiKeyMasked: maskKey((v as any).apiKey), updatedAt: (v as any).updatedAt }
          : null,
      ])
    ),
    source: fromEnv ? 'env' : configuredAny ? 'store' : 'none',
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { exchange?: DeltaExchangeId; apiKey?: string; apiSecret?: string; baseUrl?: string };
    const apiKey = body.apiKey?.trim();
    const apiSecret = body.apiSecret?.trim();
    const baseUrl = body.baseUrl?.trim();
    const exchange = body.exchange;

    if (!apiKey || !apiSecret) {
      return Response.json({ ok: false, error: 'apiKey and apiSecret are required' }, { status: 400 });
    }

    // Validate by hitting wallet endpoint with these creds
    const res = await deltaFetch<any>({
      method: 'GET',
      path: '/v2/wallet/balances',
      auth: { apiKey, apiSecret },
      baseUrl,
    });

    await writeDeltaCredentials({ exchange, apiKey, apiSecret, baseUrl });

    const headers = new Headers();
    if (exchange) headers.append('set-cookie', `exchange=${encodeURIComponent(exchange)}; Path=/; Max-Age=31536000; SameSite=Lax`);

    return new Response(
      JSON.stringify({
      ok: true,
      message: 'Saved and validated',
      walletSample: Array.isArray(res.result) ? res.result.slice(0, 3) : res.result ?? res,
      }),
      { headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' } }
    );
  } catch (e: any) {
    // Add a hint to the log that this happened during credential validation.
    await appendDeltaLog({
      level: 'error',
      context: 'credentials.validate',
      message: e?.message || 'unknown',
    });
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const exchange = (searchParams.get('exchange') || undefined) as DeltaExchangeId | undefined;
    await clearDeltaCredentials(exchange);
    return Response.json({ ok: true, cleared: exchange || 'all' });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}


