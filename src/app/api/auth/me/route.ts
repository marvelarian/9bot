export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAuthedEmailFromRequestCookie } from '@/lib/server/auth';

export async function GET() {
  try {
    const email = await getAuthedEmailFromRequestCookie();
    if (!email) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: true, email });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'me failed' }, { status: 500 });
  }
}






