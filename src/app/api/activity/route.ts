export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { listActivity } from '@/lib/server/bots-store';

export async function GET() {
  try {
    const email = await requireAuthedEmail();
    const activity = await listActivity(email);
    return NextResponse.json({ ok: true, activity });
  } catch (e: any) {
    const msg = e?.message || 'activity failed';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






