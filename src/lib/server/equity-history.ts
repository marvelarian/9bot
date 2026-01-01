import { readJsonFile, writeJsonFile } from '@/lib/server/file-store';

export type EquityMode = 'live' | 'paper';

type EquitySeries = { label: string; series: number[] };

type EquityDbV1 = {
  byEmail: Record<string, EquitySeries>;
};

type EquityDbV2 = {
  version: 2;
  byEmail: Record<string, { live: EquitySeries; paper: EquitySeries }>;
};

const FILE = 'equity-history.json';
const MAX_POINTS = 240;

function isV2(x: any): x is EquityDbV2 {
  return x && typeof x === 'object' && x.version === 2 && x.byEmail && typeof x.byEmail === 'object';
}

async function readDb(): Promise<EquityDbV2> {
  const raw = await readJsonFile<any>(FILE, { byEmail: {} });
  if (isV2(raw)) return raw;

  // Migrate v1 -> v2 (best-effort): treat old series as "live" and start paper empty.
  const v1 = raw as EquityDbV1;
  const byEmail: EquityDbV2['byEmail'] = {};
  for (const email of Object.keys(v1.byEmail || {})) {
    const live = v1.byEmail[email] || { label: '—', series: [] };
    byEmail[email] = { live, paper: { label: '—', series: [] } };
  }
  return { version: 2, byEmail };
}

async function writeDb(db: EquityDbV2) {
  await writeJsonFile(FILE, db);
}

export async function getEquityHistory(email: string, mode: EquityMode = 'live') {
  const db = await readDb();
  const rec = db.byEmail[email] || {
    live: { label: '—', series: [] },
    paper: { label: '—', series: [] },
  };
  return mode === 'paper' ? rec.paper : rec.live;
}

export async function appendEquityPoint(email: string, point: { mode?: EquityMode; label: string; value: number }) {
  const mode: EquityMode = point.mode === 'paper' ? 'paper' : 'live';
  const db = await readDb();
  const rec = db.byEmail[email] || {
    live: { label: point.label || '—', series: [] },
    paper: { label: point.label || '—', series: [] },
  };

  const prev = mode === 'paper' ? rec.paper : rec.live;
  const label = point.label || prev.label || '—';
  const series = Array.isArray(prev.series) ? prev.series.slice() : [];
  series.push(point.value);
  const next: EquitySeries = { label, series: series.slice(-MAX_POINTS) };

  db.byEmail[email] = mode === 'paper' ? { ...rec, paper: next } : { ...rec, live: next };
  await writeDb(db);
  return mode === 'paper' ? db.byEmail[email].paper : db.byEmail[email].live;
}






