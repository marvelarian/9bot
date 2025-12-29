export const runtime = 'nodejs';

import { setActiveDeltaExchange, type DeltaExchangeId } from '@/lib/delta-credentials-store';
import { readAllDeltaCredentials } from '@/lib/delta-credentials-store';
import { cookies } from 'next/headers';

function isDeltaExchangeId(x: any): x is DeltaExchangeId {
  return x === 'delta_india' || x === 'delta_global';
}

export async function GET() {
  try {
    const fromCookie = cookies().get('exchange')?.value || null;
    if (isDeltaExchangeId(fromCookie)) return Response.json({ ok: true, exchange: fromCookie });
    const all = await readAllDeltaCredentials();
    if (all?.active && isDeltaExchangeId(all.active)) return Response.json({ ok: true, exchange: all.active });
    return Response.json({ ok: true, exchange: 'delta_india' });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { exchange?: string };
    const exchange = body?.exchange;
    if (!isDeltaExchangeId(exchange)) {
      return Response.json({ ok: false, error: 'Invalid exchange' }, { status: 400 });
    }

    // Persist on server (best-effort) and set cookie for routing.
    await setActiveDeltaExchange(exchange);

    const headers = new Headers();
    headers.append('set-cookie', `exchange=${encodeURIComponent(exchange)}; Path=/; Max-Age=31536000; SameSite=Lax`);
    return new Response(JSON.stringify({ ok: true, exchange }), { headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' } });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}





