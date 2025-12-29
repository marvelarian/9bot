export const runtime = 'nodejs';

import { deltaFetch } from '@/lib/delta-signing';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol')?.toUpperCase();

    const res = await deltaFetch<any>({
      method: 'GET',
      path: '/v2/products',
    });
    const list = res.result ?? res;
    const found = symbol ? (Array.isArray(list) ? list.find((p: any) => p?.symbol === symbol) : null) : null;

    return Response.json({ ok: true, result: symbol ? found : list });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}


