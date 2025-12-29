export const runtime = 'nodejs';

import { promises as fs } from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/server/file-store';

const LOG_PATH = resolveDataPath('delta-api.log');

type LogRow = {
  ts: string;
  level?: string;
  baseUrl?: string;
  path?: string;
  method?: string;
  status?: number;
  statusText?: string;
  apiKeyMasked?: string;
  response?: any;
  context?: any;
};

function parseLine(line: string): LogRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace <= 0) return null;
  const ts = trimmed.slice(0, firstSpace);
  const rest = trimmed.slice(firstSpace + 1);
  try {
    const obj = JSON.parse(rest);
    return { ts, ...(obj || {}) };
  } catch {
    return { ts, response: rest };
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawMode = searchParams.get('raw') === '1';
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || '50')));
    const cursor = Math.max(0, Number(searchParams.get('cursor') || '0')); // how many lines from the end we've already consumed

    let raw = '';
    try {
      raw = await fs.readFile(LOG_PATH, 'utf8');
    } catch {
      return Response.json({ ok: true, entries: [], total: 0, nextCursor: null });
    }

    if (rawMode) {
      return new Response(raw, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'content-disposition': 'attachment; filename="delta-api.log"',
        },
      });
    }

    const lines = raw.split('\n').filter(Boolean);

    const end = Math.max(0, lines.length - cursor);
    const start = Math.max(0, end - limit);
    const slice = lines.slice(start, end);
    const parsed = slice.map(parseLine).filter(Boolean) as LogRow[];

    // Return newest-first for UI convenience
    const entries = parsed.reverse();
    const nextCursor = start > 0 ? cursor + limit : null;

    return Response.json({ ok: true, entries, total: lines.length, nextCursor });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}



