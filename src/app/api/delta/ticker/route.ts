export const runtime = 'nodejs';

import { deltaFetch } from '@/lib/delta-signing';
import { readDeltaCredentials } from '@/lib/delta-credentials-store';
import { DEFAULT_DELTA_BASE_URL, DELTA_INDIA_BASE_URL } from '@/lib/delta-signing';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') || 'BTCUSD').toUpperCase();
    const exchangeParam = searchParams.get('exchange') || undefined;

    const cookie = req.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;)\s*exchange=([^;]+)/);
    const exchange = m ? decodeURIComponent(m[1]) : undefined;
    const chosen = (exchangeParam || exchange) as any;
    const stored = await readDeltaCredentials(chosen);
    const baseUrl =
      stored?.baseUrl ||
      process.env.DELTA_BASE_URL ||
      (chosen === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);
    const res = await deltaFetch<any>({
      method: 'GET',
      path: `/v2/tickers/${encodeURIComponent(symbol)}`,
      baseUrl,
    });
    return Response.json({ ok: true, result: res.result ?? res });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}


