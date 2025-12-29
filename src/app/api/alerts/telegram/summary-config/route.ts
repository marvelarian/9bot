export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { getTelegramSummaryConfig, setTelegramSummaryInterval } from '@/lib/server/telegram-summary-store';

export async function GET() {
  try {
    const email = await requireAuthedEmail();
    const cfg = await getTelegramSummaryConfig(email);
    return NextResponse.json({ ok: true, config: cfg });
  } catch (e: any) {
    const msg = e?.message || 'summary config failed';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const body = await req.json().catch(() => ({}));
    const intervalMinutes = Number(body?.intervalMinutes);
    const cfg = await setTelegramSummaryInterval(email, intervalMinutes);
    return NextResponse.json({ ok: true, config: cfg });
  } catch (e: any) {
    const msg = e?.message || 'summary config failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






