import crypto from 'crypto';
import { readJsonFile, writeJsonFile } from './file-store';

export type AuthUserRecord = {
  email: string;
  passwordHash: string; // base64
  salt: string; // base64
  createdAt: number;
};

export type SessionRecord = {
  token: string;
  email: string;
  createdAt: number;
  lastSeenAt: number;
};

type UsersDb = { users: AuthUserRecord[] };
type SessionsDb = { sessions: SessionRecord[] };

const USERS_FILE = 'users.json';
const SESSIONS_FILE = 'sessions.json';

function normEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password: string, saltB64: string) {
  const salt = Buffer.from(saltB64, 'base64');
  const key = crypto.scryptSync(password, salt, 32);
  return key.toString('base64');
}

function randomToken() {
  // base64url
  return crypto.randomBytes(24).toString('base64url');
}

export async function createUser(params: { email: string; password: string }) {
  const email = normEmail(params.email);
  const password = params.password;
  if (!email) throw new Error('Email is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

  const db = await readJsonFile<UsersDb>(USERS_FILE, { users: [] });
  if (db.users.some((u) => u.email === email)) throw new Error('Account already exists for this email');

  const salt = crypto.randomBytes(16).toString('base64');
  const passwordHash = hashPassword(password, salt);
  const user: AuthUserRecord = { email, salt, passwordHash, createdAt: Date.now() };
  db.users.unshift(user);
  await writeJsonFile(USERS_FILE, db);
  return { email };
}

export async function verifyUser(params: { email: string; password: string }) {
  const email = normEmail(params.email);
  const password = params.password;
  const db = await readJsonFile<UsersDb>(USERS_FILE, { users: [] });
  const u = db.users.find((x) => x.email === email);
  if (!u) throw new Error('Invalid email or password');
  const computed = hashPassword(password, u.salt);
  if (computed !== u.passwordHash) throw new Error('Invalid email or password');
  return { email: u.email };
}

export async function createSession(emailRaw: string) {
  const email = normEmail(emailRaw);
  const db = await readJsonFile<SessionsDb>(SESSIONS_FILE, { sessions: [] });
  const token = randomToken();
  const now = Date.now();
  const session: SessionRecord = { token, email, createdAt: now, lastSeenAt: now };
  db.sessions.unshift(session);
  // keep last 200
  db.sessions = db.sessions.slice(0, 200);
  await writeJsonFile(SESSIONS_FILE, db);
  return session;
}

export async function getSession(token: string | null | undefined) {
  if (!token) return null;
  const db = await readJsonFile<SessionsDb>(SESSIONS_FILE, { sessions: [] });
  const s = db.sessions.find((x) => x.token === token) || null;
  if (!s) return null;
  // best-effort bump lastSeenAt
  try {
    s.lastSeenAt = Date.now();
    await writeJsonFile(SESSIONS_FILE, db);
  } catch {
    // ignore
  }
  return s;
}

export async function deleteSession(token: string | null | undefined) {
  if (!token) return;
  const db = await readJsonFile<SessionsDb>(SESSIONS_FILE, { sessions: [] });
  db.sessions = db.sessions.filter((x) => x.token !== token);
  await writeJsonFile(SESSIONS_FILE, db);
}






