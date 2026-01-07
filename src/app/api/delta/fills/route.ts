export const runtime = 'nodejs';

import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get('exchange') || undefined;
    const { auth, baseUrl } = await getDeltaAuth({ req, exchange });

    // Delta docs list user fills endpoint under TradeHistory.
    // Many Delta deployments expose GET /v2/fills with filters; we proxy it with optional params.
    // Delta uses different query keys across deployments; allow both `symbol` and `product_symbol`.
    const allowed = ['product_id', 'symbol', 'product_symbol', 'side', 'limit', 'start_time', 'end_time'];
    const qs = new URLSearchParams();
    for (const k of allowed) {
      const v = searchParams.get(k);
      if (v) qs.set(k, v);
    }
    const path = qs.toString() ? `/v2/fills?${qs.toString()}` : '/v2/fills';

    const res = await deltaFetch<any>({
      method: 'GET',
      path,
      auth,
      baseUrl,
    });
    return Response.json({ ok: true, result: res.result ?? res });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}


