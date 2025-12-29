import { cookies } from 'next/headers';
import { createSession, deleteSession, getSession } from './auth-store';

export const SESSION_COOKIE = 'session';

export async function getAuthedEmailFromRequestCookie(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value || null;
  const s = await getSession(token);
  return s?.email || null;
}

export async function requireAuthedEmail(): Promise<string> {
  const email = await getAuthedEmailFromRequestCookie();
  if (!email) throw new Error('Unauthorized');
  return email;
}

export async function setSessionCookieForEmail(email: string) {
  const s = await createSession(email);
  cookies().set(SESSION_COOKIE, s.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return s;
}

export async function clearSessionCookie() {
  const token = cookies().get(SESSION_COOKIE)?.value || null;
  await deleteSession(token);
  cookies().set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}






