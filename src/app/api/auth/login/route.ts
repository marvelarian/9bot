export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { verifyUser } from '@/lib/server/auth-store';
import { setSessionCookieForEmail } from '@/lib/server/auth';

// TEMP: hardcoded credential for quick deployments / demos.
// Remove once proper user management is finalized.
const DEMO_EMAIL = 'deathailc@gmail.com';
const DEMO_PASSWORD = '12345';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    // TEMP: bypass file-based users for a single known credential.
    if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      await setSessionCookieForEmail(email);
      return NextResponse.json({ ok: true, email });
    }

    const user = await verifyUser({ email, password });
    await setSessionCookieForEmail(user.email);
    return NextResponse.json({ ok: true, email: user.email });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'login failed' }, { status: 400 });
  }
}






