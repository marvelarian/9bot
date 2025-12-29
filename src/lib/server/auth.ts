import { cookies } from 'next/headers';
import { createSession, deleteSession, getSession } from './auth-store';
import crypto from 'crypto';

export const SESSION_COOKIE = 'session';

const SESSION_DAYS = 14;

function authSecret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.trim() ? s.trim() : null;
}

function b64urlEncode(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function b64urlDecode(s: string) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function sign(payloadB64: string, secret: string) {
  return b64urlEncode(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

function makeSignedSessionToken(email: string, secret: string) {
  const expMs = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ v: 1, email, expMs }), 'utf8');
  const payloadB64 = b64urlEncode(payload);
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function verifySignedSessionToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    // timingSafeEqual requires equal lengths
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as any;
    const email = typeof payload?.email === 'string' ? payload.email : null;
    const expMs = typeof payload?.expMs === 'number' ? payload.expMs : 0;
    if (!email) return null;
    if (Date.now() > expMs) return null;
    return String(email);
  } catch {
    return null;
  }
}

export async function getAuthedEmailFromRequestCookie(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value || null;
  if (!token) return null;

  // In production/serverless, file-based sessions are not reliable. Prefer stateless signed cookie if configured.
  const secret = authSecret();
  if (secret) {
    const email = verifySignedSessionToken(token, secret);
    if (email) return email;
  }

  const s = await getSession(token);
  return s?.email || null;
}

export async function requireAuthedEmail(): Promise<string> {
  const email = await getAuthedEmailFromRequestCookie();
  if (!email) throw new Error('Unauthorized');
  return email;
}

export async function setSessionCookieForEmail(email: string) {
  const secret = authSecret();
  const value = secret ? makeSignedSessionToken(email, secret) : (await createSession(email)).token;
  cookies().set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return { token: value, email, createdAt: Date.now(), lastSeenAt: Date.now() } as any;
}

export async function clearSessionCookie() {
  const token = cookies().get(SESSION_COOKIE)?.value || null;
  // Only delete server-side session records when we're using file-based sessions.
  if (!authSecret()) await deleteSession(token);
  cookies().set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}






