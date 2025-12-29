export const runtime = 'nodejs';

import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';

export async function GET(req: Request) {
  try {
    const { auth, baseUrl } = await getDeltaAuth({ req });
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // optional
    const limit = searchParams.get('limit');

    // Delta /v2/orders returns active orders; we proxy it as-is.
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (limit) qs.set('limit', limit);
    const path = qs.toString() ? `/v2/orders?${qs.toString()}` : '/v2/orders';

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


