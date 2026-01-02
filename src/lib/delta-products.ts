import { DEFAULT_DELTA_BASE_URL } from '@/lib/delta-signing';

type Product = any;

export type DeltaProductMeta = {
  id: number;
  symbol: string;
  tickSize?: number;
  contractValue?: number;
  minOrderSize?: number;
};

let cache: Record<string, { ts: number; bySymbol: Map<string, DeltaProductMeta> }> = {};
const TTL_MS = 5 * 60 * 1000;

function norm(s: string) {
  return s.trim().toUpperCase();
}

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
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

async function loadProducts(baseUrl: string): Promise<Map<string, DeltaProductMeta>> {
  const now = Date.now();
  const hit = cache[baseUrl];
  if (hit && now - hit.ts < TTL_MS) return hit.bySymbol;

  const res = await fetch(`${baseUrl}/v2/products`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Delta products failed: ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const raw = (json as any)?.result ?? json;
  const arr: Product[] = Array.isArray(raw) ? raw : [];

  const bySymbol = new Map<string, DeltaProductMeta>();
  for (const p of arr) {
    const s = pickSymbol(p);
    const id = pickProductId(p);
    if (!s || id === null) continue;

    const meta: DeltaProductMeta = {
      id,
      symbol: norm(s),
      tickSize: toNum(p?.tick_size) ?? undefined,
      contractValue: toNum(p?.contract_value) ?? undefined,
      minOrderSize: toNum(p?.product_specs?.min_order_size) ?? undefined,
    };

    bySymbol.set(meta.symbol, meta);
  }

  cache[baseUrl] = { ts: now, bySymbol };
  return bySymbol;
}

export async function getDeltaProductMeta(params: { baseUrl?: string; symbol: string }): Promise<DeltaProductMeta> {
  const baseUrl = params.baseUrl || process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL;
  const sym = norm(params.symbol);

  const bySymbol = await loadProducts(baseUrl);
  const meta = bySymbol.get(sym);
  if (!meta) throw new Error(`Unknown product symbol: ${sym}`);
  return meta;
}

export async function getDeltaProductId(params: { baseUrl?: string; symbol: string }): Promise<number> {
  const meta = await getDeltaProductMeta(params);
  return meta.id;
}









