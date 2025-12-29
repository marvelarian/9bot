import { DEFAULT_DELTA_BASE_URL } from '@/lib/delta-signing';

type Product = any;

let cache: Record<string, { ts: number; bySymbol: Map<string, number> }> = {};
const TTL_MS = 5 * 60 * 1000;

function norm(s: string) {
  return s.trim().toUpperCase();
}

function pickProductId(p: Product): number | null {
  const candidates = [p?.id, p?.product_id, p?.productId, p?.product?.id, p?.product?.product_id];
  for (const c of candidates) {
    const n = typeof c === 'number' ? c : typeof c === 'string' ? Number(c) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickSymbol(p: Product): string | null {
  const s = p?.symbol || p?.product_symbol || p?.productSymbol || p?.product?.symbol;
  return typeof s === 'string' && s.trim() ? s : null;
}

export async function getDeltaProductId(params: { baseUrl?: string; symbol: string }): Promise<number> {
  const baseUrl = params.baseUrl || process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL;
  const sym = norm(params.symbol);

  const now = Date.now();
  const hit = cache[baseUrl];
  if (hit && now - hit.ts < TTL_MS) {
    const id = hit.bySymbol.get(sym);
    if (typeof id === 'number') return id;
  }

  const res = await fetch(`${baseUrl}/v2/products`, { headers: { 'content-type': 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Delta products failed: ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const raw = (json as any)?.result ?? json;
  const arr: Product[] = Array.isArray(raw) ? raw : [];

  const bySymbol = new Map<string, number>();
  for (const p of arr) {
    const s = pickSymbol(p);
    const id = pickProductId(p);
    if (!s || id === null) continue;
    bySymbol.set(norm(s), id);
  }

  cache[baseUrl] = { ts: now, bySymbol };

  const id = bySymbol.get(sym);
  if (typeof id !== 'number') throw new Error(`Unknown product symbol: ${sym}`);
  return id;
}









