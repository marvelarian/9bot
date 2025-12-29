import { readJsonFile, writeJsonFile } from '@/lib/server/file-store';

export type TelegramSummaryConfig = {
  intervalMinutes: number; // 0 = disabled
  updatedAt: number;
  lastSentAt?: number;
};

type Db = {
  byEmail: Record<string, TelegramSummaryConfig>;
};

const FILE = 'telegram-summary.json';

function clampIntervalMinutes(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n === 0) return 0;
  // minimum 1 minute, maximum 7 days
  return Math.min(Math.max(1, Math.floor(n)), 60 * 24 * 7);
}

export async function getTelegramSummaryConfig(email: string): Promise<TelegramSummaryConfig> {
  const db = await readJsonFile<Db>(FILE, { byEmail: {} });
  const v = db.byEmail[email];
  if (!v) return { intervalMinutes: 0, updatedAt: Date.now() };
  return {
    intervalMinutes: clampIntervalMinutes(Number(v.intervalMinutes)),
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now(),
    lastSentAt: typeof v.lastSentAt === 'number' ? v.lastSentAt : undefined,
  };
}

export async function setTelegramSummaryInterval(email: string, intervalMinutes: number): Promise<TelegramSummaryConfig> {
  const db = await readJsonFile<Db>(FILE, { byEmail: {} });
  const next: TelegramSummaryConfig = {
    intervalMinutes: clampIntervalMinutes(Number(intervalMinutes)),
    updatedAt: Date.now(),
    // Keep lastSentAt so the next send uses the same schedule window.
    lastSentAt: db.byEmail[email]?.lastSentAt,
  };
  db.byEmail[email] = next;
  await writeJsonFile(FILE, db);
  return next;
}

export async function markTelegramSummarySent(email: string, ts: number): Promise<void> {
  const db = await readJsonFile<Db>(FILE, { byEmail: {} });
  const prev = db.byEmail[email] || { intervalMinutes: 0, updatedAt: Date.now() };
  db.byEmail[email] = { ...prev, lastSentAt: ts, updatedAt: Date.now() };
  await writeJsonFile(FILE, db);
}






