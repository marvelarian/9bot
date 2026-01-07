import fs from 'fs/promises';
import path from 'path';
import { resolveDataPath } from '@/lib/server/file-store';

export type AuditLevel = 'info' | 'warn' | 'error';

export type AuditEvent =
  | 'bot_start'
  | 'bot_stop_manual'
  | 'bot_stop_risk'
  | 'flatten_start'
  | 'flatten_ok'
  | 'flatten_failed'
  | 'leverage_set_ok'
  | 'leverage_set_failed'
  | 'alert_near_circuit_breaker'
  | 'alert_max_positions_hit'
  | 'alert_worker_stale';

export type AuditRow = {
  ts: number; // epoch ms
  level: AuditLevel;
  ownerEmail: string;
  botId?: string;
  exchange?: string;
  symbol?: string;
  event: AuditEvent | string;
  message?: string;
  data?: any;
};

const FILE = 'audit-log.jsonl';

function auditEnabled(): boolean {
  const v = String(process.env.AUDIT_LOG_ENABLED || '').trim().toLowerCase();
  // Default: disabled (user requested removal). Enable explicitly via AUDIT_LOG_ENABLED=true.
  return v === 'true' || v === '1' || v === 'yes';
}

async function ensureDir() {
  // file-store ensures dir for JSON helpers, but we’re writing manually
  const full = resolveDataPath(FILE);
  const dir = path.dirname(full);
  await fs.mkdir(dir, { recursive: true }).catch(() => null);
}

export async function appendAudit(row: AuditRow): Promise<void> {
  if (!auditEnabled()) return;
  await ensureDir();
  const full = resolveDataPath(FILE);
  const line = JSON.stringify(row) + '\n';
  await fs.appendFile(full, line, 'utf8');
}

export async function readAuditRaw(): Promise<string> {
  if (!auditEnabled()) return '';
  const full = resolveDataPath(FILE);
  try {
    return await fs.readFile(full, 'utf8');
  } catch {
    return '';
  }
}


