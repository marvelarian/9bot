'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { convertPnlToInr } from '@/lib/format';

type UiPositionRow = {
  key: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  entry?: number;
  entryTimeMs?: number;
  pnl?: number;
};

function toNum(v: any): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseTsMs(v: any): number | undefined {
  // Delta endpoints vary: sometimes seconds, sometimes ms, sometimes ISO strings.
  const n = toNum(v);
  if (n !== undefined) {
    if (n > 1e12) return Math.floor(n); // already ms
    if (n > 1e9) return Math.floor(n * 1000); // seconds -> ms
    // too small to be a timestamp
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function pickSymbol(p: any): string | undefined {
  const s = p?.product_symbol || p?.symbol || p?.product?.symbol || p?.market || p?.product_ticker_symbol;
  return typeof s === 'string' && s.length ? s : undefined;
}

function pickEntryPrice(p: any): number | undefined {
  return (
    toNum(p?.entry_price) ??
    toNum(p?.avg_entry_price) ??
    toNum(p?.average_entry_price) ??
    toNum(p?.avg_entry) ??
    toNum(p?.avg_price) ??
    toNum(p?.entryPrice)
  );
}

function pickPnl(p: any): number | undefined {
  const pnlValue = toNum(p?.unrealized_pnl) ?? toNum(p?.pnl) ?? toNum(p?.unrealizedPnl) ?? toNum(p?.pnl_unrealized);
  return convertPnlToInr(pnlValue);
}

function pickSideAndQty(p: any): { side: 'buy' | 'sell'; qty: number } | null {
  // try common Delta fields first
  const size =
    toNum(p?.size) ??
    toNum(p?.position_size) ??
    toNum(p?.net_quantity) ??
    toNum(p?.quantity) ??
    toNum(p?.qty);

  if (size !== undefined && size !== 0) {
    return { side: size >= 0 ? 'buy' : 'sell', qty: Math.abs(size) };
  }

  const sideRaw = String(p?.side || p?.position_side || p?.direction || '').toLowerCase();
  const qty = toNum(p?.quantity) ?? toNum(p?.qty) ?? 0;
  if ((sideRaw === 'buy' || sideRaw === 'sell') && qty) {
    return { side: sideRaw as 'buy' | 'sell', qty: Math.abs(qty) };
  }

  return null;
}

function pickEntryTimeMs(p: any): number | undefined {
  // We intentionally try many keys. If none exists, we’ll “maintain” a first-seen time in memory.
  return (
    parseTsMs(p?.entry_time) ??
    parseTsMs(p?.entry_timestamp) ??
    parseTsMs(p?.created_at) ??
    parseTsMs(p?.createdAt) ??
    parseTsMs(p?.opened_at) ??
    parseTsMs(p?.open_time) ??
    parseTsMs(p?.updated_at) ??
    parseTsMs(p?.updatedAt)
  );
}

export default function PositionsPage() {
  const [rows, setRows] = useState<UiPositionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const entryTimeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch('/api/delta/positions', { cache: 'no-store' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'positions failed');

        const list = Array.isArray(json.result) ? json.result : Array.isArray(json.result?.result) ? json.result.result : [];

        const now = Date.now();
        const nextRows: UiPositionRow[] = [];
        const map = entryTimeRef.current;
        // NOTE: we keep entry-time only in memory (no client-side storage).

        for (const p of list) {
          const symbol = pickSymbol(p);
          if (!symbol) continue;

          const sq = pickSideAndQty(p);
          if (!sq) continue;

          // ignore flat positions
          if (!sq.qty) continue;

          const key = String(p?.product_id || p?.product?.id || symbol);
          const entryFromApi = pickEntryTimeMs(p);
          const entryTimeMs = entryFromApi ?? map[symbol];

          // Maintain entry time: first time we ever see this symbol as open, persist a timestamp.
          if (!map[symbol]) {
            map[symbol] = entryTimeMs ?? now;
          }

          nextRows.push({
            key: `${key}`,
            symbol,
            side: sq.side,
            qty: sq.qty,
            entry: pickEntryPrice(p),
            entryTimeMs: map[symbol],
            pnl: pickPnl(p),
          });
        }

        // Cleanup: if a symbol is no longer open, we keep its entry time (so it’s “maintained”)
        // but we do not need to delete it; leaving it helps when position re-opens quickly.

        if (!alive) return;
        setRows(nextRows);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'positions failed');
        setRows([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    void load();
    const t = setInterval(load, 7_500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [rows]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Home</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Open Positions</h1>
      <p className="mt-2 text-sm text-slate-600">Live positions from Delta (via server-side proxy). Entry time is stored per-symbol once a position is first seen open.</p>

      <div className="mt-6">
        <Card>
          <CardHeader title="Positions" subtitle={error ? `Error: ${error}` : 'Auto-refresh every ~7.5s'} />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-left font-medium">Side</th>
                    <th className="px-5 py-3 text-right font-medium">Qty</th>
                    <th className="px-5 py-3 text-right font-medium">Entry</th>
                    <th className="px-5 py-3 text-right font-medium">Entry time</th>
                    <th className="px-5 py-3 text-right font-medium">PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="px-5 py-4">
                        <Badge tone={r.side === 'buy' ? 'green' : 'red'}>{r.side.toUpperCase()}</Badge>
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">{r.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.entry === undefined ? '—' : `$${r.entry.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.entryTimeMs ? new Date(r.entryTimeMs).toLocaleString() : '—'}
                      </td>
                      <td className={`px-5 py-4 text-right font-semibold ${typeof r.pnl === 'number' && r.pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {typeof r.pnl === 'number' ? `${r.pnl >= 0 ? '+' : ''}${r.pnl.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '—'}
                      </td>
                    </tr>
                  ))}

                  {sorted.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={6}>
                        {loading ? 'Loading…' : error ? 'No data (check API Integration credentials).' : 'No open positions.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


