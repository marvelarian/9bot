export const runtime = 'nodejs';

import { readAuditRaw, type AuditRow } from '@/lib/server/audit-log-store';

function safeParse(line: string): AuditRow | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t);
    if (!obj || typeof obj !== 'object') return null;
    return obj as AuditRow;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || '50')));
    const cursor = Math.max(0, Number(searchParams.get('cursor') || '0')); // lines consumed from end
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const botId = (searchParams.get('botId') || '').trim();
    const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();
    const level = (searchParams.get('level') || '').trim();
    const event = (searchParams.get('event') || '').trim();

    const raw = await readAuditRaw();
    if (!raw) return Response.json({ ok: true, entries: [], total: 0, nextCursor: null });

    const lines = raw.split('\n').filter(Boolean);
    const end = Math.max(0, lines.length - cursor);
    const start = Math.max(0, end - limit);
    const slice = lines.slice(start, end);

    let entries = slice.map(safeParse).filter(Boolean) as AuditRow[];

    if (botId) entries = entries.filter((e) => String(e.botId || '') === botId);
    if (symbol) entries = entries.filter((e) => String(e.symbol || '').toUpperCase() === symbol);
    if (level) entries = entries.filter((e) => String(e.level || '') === level);
    if (event) entries = entries.filter((e) => String(e.event || '') === event);
    if (q) {
      entries = entries.filter((e) => {
        const hay = `${e.event} ${e.message || ''} ${JSON.stringify(e.data || {})}`.toLowerCase();
        return hay.includes(q);
      });
    }

    // newest-first for UI
    entries = entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const nextCursor = start > 0 ? cursor + limit : null;
    return Response.json({ ok: true, entries, total: lines.length, nextCursor });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}



