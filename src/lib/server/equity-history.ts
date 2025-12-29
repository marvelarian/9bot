import { readJsonFile, writeJsonFile } from '@/lib/server/file-store';

type EquityDb = {
  byEmail: Record<string, { label: string; series: number[] }>;
};

const FILE = 'equity-history.json';

export async function getEquityHistory(email: string) {
  const db = await readJsonFile<EquityDb>(FILE, { byEmail: {} });
  return db.byEmail[email] || { label: '—', series: [] };
}

export async function appendEquityPoint(email: string, point: { label: string; value: number }) {
  const db = await readJsonFile<EquityDb>(FILE, { byEmail: {} });
  const prev = db.byEmail[email] || { label: point.label, series: [] };

  const label = point.label || prev.label || '—';
  const series = Array.isArray(prev.series) ? prev.series.slice() : [];
  series.push(point.value);

  db.byEmail[email] = { label, series: series.slice(-120) };
  await writeJsonFile(FILE, db);
  return db.byEmail[email];
}






