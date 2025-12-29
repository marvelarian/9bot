export const runtime = 'nodejs';

import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get('exchange') || undefined;
    const { auth, baseUrl } = await getDeltaAuth({ req, exchange });
    const res = await deltaFetch<any>({
      method: 'GET',
      path: '/v2/positions/margined',
      auth,
      baseUrl,
    });
    return Response.json({ ok: true, result: res.result ?? res });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}


