export const runtime = 'nodejs';

import { readDeltaCredentials } from '@/lib/delta-credentials-store';
import { DEFAULT_DELTA_BASE_URL, DELTA_INDIA_BASE_URL } from '@/lib/delta-signing';

type Ticker = any;
type Product = any;

let productsCache: { baseUrl: string; ts: number; optionSymbols: Set<string> } | null = null;
const PRODUCTS_TTL_MS = 5 * 60 * 1000;

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickSymbol(t: Ticker): string | null {
  const s = t?.symbol || t?.product_symbol || t?.product?.symbol || t?.product_ticker_symbol;
  return typeof s === 'string' && s.length ? s : null;
}

function looksLikeOptionSymbol(symbol: string) {
  // Common option encodings: BTC-27DEC25-100000-C / BTC-27DEC25-100000-P
  if (/-\d{1,2}[A-Z]{3}\d{2}-\d+-(C|P)$/.test(symbol)) return true;
  if (/(CALL|PUT)$/.test(symbol)) return true;
  return false;
}

function pickLast(t: Ticker): number | null {
  return (
    toNum(t?.mark_price) ??
    toNum(t?.markPrice) ??
    toNum(t?.last_price) ??
    toNum(t?.lastPrice) ??
    toNum(t?.close) ??
    toNum(t?.close_price)
  );
}

function pickOpen(t: Ticker): number | null {
  return toNum(t?.open) ?? toNum(t?.open_price) ?? toNum(t?.openPrice);
}

function pickChangePct(t: Ticker): number | null {
  // Try common fields first
  const direct =
    toNum(t?.price_change_percent) ??
    toNum(t?.price_change_pct) ??
    toNum(t?.change_pct) ??
    toNum(t?.changePercent) ??
    toNum(t?.change_24h) ??
    toNum(t?.percent_change_24h);
  if (direct !== null) return direct;

  // Fallback: compute from open -> last
  const last = pickLast(t);
  const open = pickOpen(t);
  if (last !== null && open !== null && open !== 0) {
    return ((last - open) / open) * 100;
  }
  return null;
}

async function getOptionSymbols(baseUrl: string): Promise<Set<string>> {
  const now = Date.now();
  if (productsCache && productsCache.baseUrl === baseUrl && now - productsCache.ts < PRODUCTS_TTL_MS) {
    return productsCache.optionSymbols;
  }

  const res = await fetch(`${baseUrl}/v2/products`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    // If products fails, fall back to regex-only filtering
    const s = new Set<string>();
    productsCache = { baseUrl, ts: now, optionSymbols: s };
    return s;
  }
  const json = (await res.json()) as { result?: any };
  const raw = json?.result ?? json;
  const arr: Product[] = Array.isArray(raw) ? raw : [];

  const optionSymbols = new Set<string>();
  for (const p of arr) {
    const sym = typeof p?.symbol === 'string' ? p.symbol : typeof p?.product_symbol === 'string' ? p.product_symbol : null;
    if (!sym) continue;
    const contractType = String(p?.contract_type || p?.contractType || '').toLowerCase();
    const productType = String(p?.product_type || p?.productType || '').toLowerCase();
    // Delta commonly uses: call_option / put_option (or product_type: option)
    const isOption =
      contractType.includes('option') ||
      contractType === 'call_option' ||
      contractType === 'put_option' ||
      productType.includes('option');
    if (isOption) optionSymbols.add(sym);
  }

  productsCache = { baseUrl, ts: now, optionSymbols };
  return optionSymbols;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get('limit') || '5')));
    const exchangeParam = searchParams.get('exchange') || undefined;

    const cookie = req.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;)\s*exchange=([^;]+)/);
    const exchange = m ? decodeURIComponent(m[1]) : undefined;
    const chosen = (exchangeParam || exchange) as any;
    const stored = await readDeltaCredentials(chosen);
    const baseUrl =
      stored?.baseUrl ||
      process.env.DELTA_BASE_URL ||
      (chosen === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);
    const optionSymbols = await getOptionSymbols(baseUrl);

    const res = await fetch(`${baseUrl}/v2/tickers`, {
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Delta tickers failed: ${res.status}`);
    const json = (await res.json()) as { result?: any };
    const raw = json?.result ?? json;

    const arr: Ticker[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw)
        : [];

    const rows = arr
      .map((t) => {
        const symbol = pickSymbol(t);
        const last = pickLast(t);
        const changePct = pickChangePct(t);
        if (!symbol || last === null || changePct === null) return null;
        // Exclude options (calls/puts). Some environments expose options in /v2/tickers.
        if (optionSymbols.has(symbol) || looksLikeOptionSymbol(symbol)) return null;
        // Light filter to avoid non-market symbols
        if (symbol.length > 24) return null;
        return { symbol, last, changePct };
      })
      .filter(Boolean) as Array<{ symbol: string; last: number; changePct: number }>;

    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
    const gainers = sorted.slice(0, limit);
    const losers = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, limit);

    return Response.json({ ok: true, baseUrl, gainers, losers });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: e?.status || 500 });
  }
}


