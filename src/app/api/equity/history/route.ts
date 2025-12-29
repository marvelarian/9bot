export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { appendEquityPoint, getEquityHistory } from '@/lib/server/equity-history';

export async function GET() {
  try {
    const email = await requireAuthedEmail();
    const hist = await getEquityHistory(email);
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
    const label = String(body?.label || '');
    const value = Number(body?.value);
    if (!Number.isFinite(value)) return NextResponse.json({ ok: false, error: 'value must be a number' }, { status: 400 });
    const hist = await appendEquityPoint(email, { label, value });
    return NextResponse.json({ ok: true, label: hist.label, series: hist.series });
  } catch (e: any) {
    const msg = e?.message || 'equity history failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






