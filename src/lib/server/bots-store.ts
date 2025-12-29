import type { ActivityEvent, BotRecord } from '@/lib/bots/types';
import type { GridBotConfig } from '@/lib/types';
import { sendTelegramText } from '@/lib/telegram-send';
import { readJsonFile, writeJsonFile } from '@/lib/server/file-store';

type BotsDb = {
  bots: BotRecord[];
  activity: ActivityEvent[];
};

const FILE = 'bots.json';

function now() {
  return Date.now();
}

function normSymbol(s: string | undefined | null) {
  return String(s || '').trim().toUpperCase();
}

function normExchange(ex: any) {
  return ex === 'delta_global' ? 'delta_global' : 'delta_india';
}

function makeId(prefix: string) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readDb(): Promise<BotsDb> {
  return readJsonFile<BotsDb>(FILE, { bots: [], activity: [] });
}

async function writeDb(db: BotsDb) {
  await writeJsonFile(FILE, db);
}

async function pushActivity(db: BotsDb, evt: Omit<ActivityEvent, 'id' | 'ts'> & { ts?: number }) {
  const record: ActivityEvent = {
    id: makeId('act'),
    ts: evt.ts ?? now(),
    ...evt,
  };
  db.activity = [record, ...(db.activity || [])].slice(0, 200);

  // Telegram notifications (best-effort): bot lifecycle + emergency stops.
  try {
    const t = record.type;
    const shouldSend =
      t === 'bot.created' || t === 'bot.started' || t === 'bot.stopped' || t === 'bot.deleted' || t === 'bots.emergency_stop';
    if (!shouldSend) return;

    const exLabel = record.exchange ? (record.exchange === 'delta_global' ? 'Delta Global' : 'Delta India') : null;
    const title =
      t === 'bot.created'
        ? 'Bot created'
        : t === 'bot.started'
          ? 'Bot started'
          : t === 'bot.stopped'
            ? 'Bot stopped'
            : t === 'bot.deleted'
              ? 'Bot deleted'
              : 'Emergency stop';

    const lines = [
      `<b>9BOT</b> — ${title}`,
      record.name ? `<b>Bot:</b> ${record.name}` : null,
      record.symbol ? `<b>Symbol:</b> ${record.symbol}` : null,
      exLabel ? `<b>Exchange:</b> ${exLabel}` : null,
      `<b>Time:</b> ${new Date(record.ts).toISOString()}`,
    ].filter(Boolean);

    await sendTelegramText(lines.join('\n'));
  } catch {
    // ignore
  }
}

export async function listBots(ownerEmail: string): Promise<BotRecord[]> {
  const db = await readDb();
  return (db.bots || []).filter((b) => (b.ownerEmail || '') === ownerEmail);
}

export async function listActivity(ownerEmail: string): Promise<ActivityEvent[]> {
  const db = await readDb();
  return (db.activity || []).filter((a) => (a.ownerEmail || '') === ownerEmail);
}

export async function createBotForUser(ownerEmail: string, config: GridBotConfig, name?: string): Promise<BotRecord> {
  const db = await readDb();

  const id = makeId('bot');
  const rec: BotRecord = {
    id,
    ownerEmail,
    name: name || `${config.symbol} Grid`,
    config: config as any,
    isRunning: false,
    createdAt: now(),
    updatedAt: now(),
  };

  db.bots = [rec, ...(db.bots || [])];
  await pushActivity(db, {
    type: 'bot.created',
    botId: rec.id,
    symbol: rec.config.symbol,
    name: rec.name,
    exchange: normExchange((rec.config as any)?.exchange) as any,
    ownerEmail,
  });
  await writeDb(db);
  return rec;
}

export async function patchBotForUser(
  ownerEmail: string,
  id: string,
  patch: Partial<Omit<BotRecord, 'id' | 'createdAt'>>
): Promise<BotRecord | null> {
  const db = await readDb();
  const idx = (db.bots || []).findIndex((b) => b.id === id && b.ownerEmail === ownerEmail);
  if (idx === -1) return null;

  const prev = db.bots[idx];

  // Enforce exchange constraint: only one RUNNING bot per symbol per exchange.
  if (patch.isRunning === true && prev.isRunning === false) {
    const sym = normSymbol(prev.config?.symbol);
    const ex = normExchange((prev.config as any)?.exchange);
    const conflict = (db.bots || []).find(
      (b) =>
        b.ownerEmail === ownerEmail &&
        b.id !== id &&
        b.isRunning &&
        normExchange((b.config as any)?.exchange) === ex &&
        normSymbol(b.config.symbol) === sym
    );
    if (conflict) return null;
  }

  const next: BotRecord = {
    ...prev,
    ...patch,
    runtime:
      patch.runtime !== undefined
        ? {
            ...(prev.runtime || {}),
            ...(patch.runtime as any),
          }
        : prev.runtime,
    updatedAt: now(),
  };
  db.bots[idx] = next;

  // Activity: start/stop transitions
  if (typeof patch.isRunning === 'boolean' && patch.isRunning !== prev.isRunning) {
    await pushActivity(db, {
      type: patch.isRunning ? 'bot.started' : 'bot.stopped',
      botId: next.id,
      symbol: next.config.symbol,
      name: next.name,
      exchange: normExchange((next.config as any)?.exchange) as any,
      ownerEmail,
    });
  }

  await writeDb(db);
  return next;
}

export async function deleteBotForUser(ownerEmail: string, id: string): Promise<boolean> {
  const db = await readDb();
  const b = (db.bots || []).find((x) => x.id === id && x.ownerEmail === ownerEmail) || null;
  db.bots = (db.bots || []).filter((x) => !(x.id === id && x.ownerEmail === ownerEmail));
  if (!b) {
    await writeDb(db);
    return false;
  }

  await pushActivity(db, {
    type: 'bot.deleted',
    botId: id,
    symbol: b?.config.symbol,
    name: b?.name,
    exchange: b ? (normExchange((b.config as any)?.exchange) as any) : undefined,
    ownerEmail,
  });
  await writeDb(db);
  return true;
}

export async function emergencyStopForUser(ownerEmail: string, exchange?: 'delta_india' | 'delta_global') {
  const db = await readDb();
  const ex = exchange ? normExchange(exchange) : null;

  db.bots = (db.bots || []).map((b) => {
    if ((b.ownerEmail || '') !== ownerEmail) return b;
    const bEx = normExchange((b.config as any)?.exchange);
    const shouldStop = ex ? bEx === ex : true;
    if (!shouldStop) return b;
    return { ...b, isRunning: false, updatedAt: now() };
  });

  await pushActivity(db, { type: 'bots.emergency_stop', exchange: (ex as any) || undefined, ownerEmail });
  await writeDb(db);
}






