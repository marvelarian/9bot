export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { emergencyStopForUser } from '@/lib/server/bots-store';

export async function POST(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const body = await req.json().catch(() => ({}));
    const exchange = body?.exchange;
    await emergencyStopForUser(email, exchange);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || 'emergency stop failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






