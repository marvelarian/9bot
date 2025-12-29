export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { verifyUser } from '@/lib/server/auth-store';
import { setSessionCookieForEmail } from '@/lib/server/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim();
    const password = String(body?.password || '');

    const user = await verifyUser({ email, password });
    await setSessionCookieForEmail(user.email);
    return NextResponse.json({ ok: true, email: user.email });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'login failed' }, { status: 400 });
  }
}






