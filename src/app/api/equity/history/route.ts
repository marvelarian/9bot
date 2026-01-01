export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { appendEquityPoint, getEquityHistory } from '@/lib/server/equity-history';

export async function GET(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get('mode') || 'live') as any;
    const hist = await getEquityHistory(email, mode === 'paper' ? 'paper' : 'live');
    return NextResponse.json({ ok: true, label: hist.label, series: hist.series });
  } catch (e: any) {
    const msg = e?.message || 'equity history failed';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'paper' ? 'paper' : 'live';
    const label = String(body?.label || '');
    const value = Number(body?.value);
    if (!Number.isFinite(value)) return NextResponse.json({ ok: false, error: 'value must be a number' }, { status: 400 });
    const hist = await appendEquityPoint(email, { mode, label, value });
    return NextResponse.json({ ok: true, label: hist.label, series: hist.series });
  } catch (e: any) {
    const msg = e?.message || 'equity history failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






