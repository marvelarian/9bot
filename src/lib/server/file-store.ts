import fs from 'fs/promises';
import path from 'path';

type LockMap = Map<string, Promise<void>>;

function getLocks(): LockMap {
  const g = globalThis as any;
  if (!g.__fileStoreLocks) g.__fileStoreLocks = new Map<string, Promise<void>>();
  return g.__fileStoreLocks as LockMap;
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = getLocks();
  const prev = locks.get(key) || Promise.resolve();

  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(key, prev.then(() => next));

  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Cleanup when queue is empty
    if (locks.get(key) === next) locks.delete(key);
  }
}

export function getDataRoot() {
  // Allow overriding storage location (recommended in production).
  // Example: DATA_DIR=/var/lib/9bot/data (VM) or a mounted volume path (Docker).
  const explicit = process.env.DATA_DIR;
  if (explicit && explicit.trim()) return explicit.trim();

  // Vercel/AWS serverless filesystem: project directory is read-only (/var/task).
  // Only /tmp is writable, but it is EPHEMERAL (not durable across cold starts/deploys).
  // If you need persistence on Vercel, move this store to a real DB/KV.
  const isServerless =
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT);
  if (isServerless) return path.join('/tmp', '9bot-data');

  // Local/dev/server with writable workspace.
  return path.join(process.cwd(), 'src', 'data');
}

export function resolveDataPath(...parts: string[]) {
  return path.join(getDataRoot(), ...parts);
}

async function ensureDataDir() {
  await fs.mkdir(getDataRoot(), { recursive: true });
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const full = resolveDataPath(fileName);
  return withLock(full, async () => {
    try {
      const raw = await fs.readFile(full, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  });
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  await ensureDataDir();
  const full = resolveDataPath(fileName);
  return withLock(full, async () => {
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(value, null, 2);
    await fs.writeFile(tmp, payload, 'utf8');
    try {
      // On Windows, rename fails if target exists; unlink first.
      await fs.unlink(full).catch(() => null);
      await fs.rename(tmp, full);
    } finally {
      await fs.unlink(tmp).catch(() => null);
    }
  });
}






