import { readJsonFile, writeJsonFile } from '@/lib/server/file-store';

type Db = {
  lastSentAtByKey: Record<string, number>;
};

const FILE = 'telegram-alerts.json';

function key(ownerEmail: string, botId: string, alertType: string) {
  return `${ownerEmail}::${botId}::${alertType}`;
}

export async function canSendTelegramAlert(params: {
  ownerEmail: string;
  botId: string;
  alertType: string;
  minIntervalMs: number;
  now?: number;
}): Promise<boolean> {
  const now = typeof params.now === 'number' ? params.now : Date.now();
  const db = await readJsonFile<Db>(FILE, { lastSentAtByKey: {} });
  const k = key(params.ownerEmail, params.botId, params.alertType);
  const last = db.lastSentAtByKey[k] || 0;
  return last === 0 || now - last >= params.minIntervalMs;
}

export async function markTelegramAlertSent(params: { ownerEmail: string; botId: string; alertType: string; now?: number }): Promise<void> {
  const now = typeof params.now === 'number' ? params.now : Date.now();
  const db = await readJsonFile<Db>(FILE, { lastSentAtByKey: {} });
  const k = key(params.ownerEmail, params.botId, params.alertType);
  db.lastSentAtByKey[k] = now;
  await writeJsonFile(FILE, db);
}



