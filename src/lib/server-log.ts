import { promises as fs } from 'fs';
import path from 'path';

const LOG_PATH = path.join(process.cwd(), 'data', 'delta-api.log');

function safeJson(obj: unknown) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '"<unserializable>"';
  }
}

export async function appendDeltaLog(line: Record<string, unknown>) {
  const entry = `${new Date().toISOString()} ${safeJson(line)}\n`;
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, entry, 'utf8');
  } catch {
    // ignore logging failures
  }
}











