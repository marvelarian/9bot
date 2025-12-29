'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

type UiFillRow = {
  id: string;
  timeMs?: number;
  symbol: string;
  side: 'buy' | 'sell' | '—';
  qty?: number;
  price?: number;
  fee?: number;
  orderId?: string;
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
  const n = toNum(v);
  if (n !== undefined) {
    if (n > 1e12) return Math.floor(n);
    if (n > 1e9) return Math.floor(n * 1000);
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function pickSymbol(f: any): string {
  const s = f?.product_symbol || f?.symbol || f?.product?.symbol || f?.market;
  return typeof s === 'string' && s.length ? s : '—';
}

function pickSide(f: any): UiFillRow['side'] {
  const s = String(f?.side || f?.order_side || f?.direction || '').toLowerCase();
  return s === 'buy' || s === 'sell' ? (s as any) : '—';
}

function pickFee(f: any): number | undefined {
  return toNum(f?.fee) ?? toNum(f?.commission) ?? toNum(f?.trading_fee);
}

function downloadCsv(filename: string, rows: string[][]) {
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FillsPage() {
  const [rows, setRows] = useState<UiFillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [limit, setLimit] = useState<number>(100);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (symbol.trim()) qs.set('symbol', symbol.trim().toUpperCase());
      if (side !== 'all') qs.set('side', side);
      if (limit) qs.set('limit', String(limit));

      const url = qs.toString() ? `/api/delta/fills?${qs.toString()}` : '/api/delta/fills';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'fills failed');

      const list = Array.isArray(json.result) ? json.result : Array.isArray(json.result?.result) ? json.result.result : [];
      const mapped: UiFillRow[] = list.map((f: any) => ({
        id: String(f?.id || f?.fill_id || f?.trade_id || `${f?.order_id || 'fill'}-${f?.created_at || ''}`),
        timeMs: parseTsMs(f?.created_at ?? f?.createdAt ?? f?.timestamp ?? f?.time),
        symbol: pickSymbol(f),
        side: pickSide(f),
        qty: toNum(f?.size ?? f?.quantity ?? f?.qty ?? f?.filled_size),
        price: toNum(f?.price ?? f?.fill_price ?? f?.avg_fill_price ?? f?.average_fill_price),
        fee: pickFee(f),
        orderId: f?.order_id ? String(f.order_id) : f?.order?.id ? String(f.order.id) : undefined,
      }));

      setRows(mapped);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'fills failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b.timeMs || 0) - (a.timeMs || 0));
  }, [rows]);

  const exportCsv = () => {
    const header = ['time', 'fill_id', 'symbol', 'side', 'qty', 'price', 'fee', 'order_id'];
    const body = sorted.map((r) => [
      r.timeMs ? new Date(r.timeMs).toISOString() : '',
      r.id,
      r.symbol,
      r.side,
      r.qty?.toString() || '',
      r.price?.toString() || '',
      r.fee?.toString() || '',
      r.orderId || '',
    ]);
    downloadCsv(`fills-${Date.now()}.csv`, [header, ...body]);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Trading</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Trade Journal (Fills)</h1>
      <p className="mt-2 text-sm text-slate-600">Live fills from Delta Exchange (server-side proxy).</p>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Fills"
            subtitle={error ? `Error: ${error}` : `Showing ${sorted.length} fills`}
            right={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="Symbol (e.g. BTCUSD)"
                  className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as any)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="all">All sides</option>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
                <select
                  value={String(limit)}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  Apply
                </Button>
                <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!sorted.length}>
                  Export CSV
                </Button>
              </div>
            }
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Time</th>
                    <th className="px-5 py-3 text-left font-medium">Fill ID</th>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-left font-medium">Side</th>
                    <th className="px-5 py-3 text-right font-medium">Qty</th>
                    <th className="px-5 py-3 text-right font-medium">Price</th>
                    <th className="px-5 py-3 text-right font-medium">Fee</th>
                    <th className="px-5 py-3 text-left font-medium">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 text-xs text-slate-500">{r.timeMs ? new Date(r.timeMs).toLocaleString() : '—'}</td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-700">{r.id}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="px-5 py-4">
                        {r.side === '—' ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <Badge tone={r.side === 'buy' ? 'green' : 'red'}>{r.side.toUpperCase()}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.qty === undefined ? '—' : r.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.price === undefined ? '—' : r.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.fee === undefined ? '—' : r.fee.toLocaleString(undefined, { maximumFractionDigits: 10 })}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-700">{r.orderId || '—'}</td>
                    </tr>
                  ))}

                  {sorted.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={8}>
                        {loading ? 'Loading…' : error ? 'No data (check API Integration permissions).' : 'No fills found.'}
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










