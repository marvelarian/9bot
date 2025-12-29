'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { BotRecord } from '@/lib/bot-store';

type UiOrderRow = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell' | '—';
  type: string;
  status: string;
  error?: string;
  price?: number;
  qty?: number;
  createdAtMs?: number;
  trigger?: string;
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

function pickSymbol(o: any): string {
  const s = o?.product_symbol || o?.symbol || o?.product?.symbol || o?.market;
  return typeof s === 'string' && s.length ? s : '—';
}

function pickSide(o: any): UiOrderRow['side'] {
  const s = String(o?.side || o?.order_side || o?.direction || '').toLowerCase();
  return s === 'buy' || s === 'sell' ? (s as any) : '—';
}

function pickType(o: any): string {
  const t = o?.order_type || o?.type || o?.orderType;
  return typeof t === 'string' && t.length ? t : '—';
}

function pickStatus(o: any): string {
  const s = o?.state || o?.status || o?.order_state || o?.orderStatus;
  return typeof s === 'string' && s.length ? s : '—';
}

function pickPrice(o: any): number | undefined {
  return toNum(o?.limit_price) ?? toNum(o?.price) ?? toNum(o?.avg_fill_price) ?? toNum(o?.average_fill_price);
}

function pickQty(o: any): number | undefined {
  return toNum(o?.size) ?? toNum(o?.quantity) ?? toNum(o?.qty) ?? toNum(o?.filled_size);
}

function pickCreatedAt(o: any): number | undefined {
  return parseTsMs(o?.created_at) ?? parseTsMs(o?.createdAt) ?? parseTsMs(o?.timestamp) ?? parseTsMs(o?.time);
}

function toneForStatus(status: string): 'slate' | 'green' | 'red' | 'yellow' | 'blue' {
  const s = status.toLowerCase();
  if (s.includes('filled') || s === 'closed') return 'green';
  if (s.includes('cancel') || s.includes('rejected')) return 'red';
  if (s.includes('open') || s.includes('live')) return 'blue';
  if (s.includes('pending') || s.includes('part')) return 'yellow';
  return 'slate';
}

export default function OrdersPage() {
  const [rows, setRows] = useState<UiOrderRow[]>([]);
  const [status, setStatus] = useState<'all' | 'open'>('all');
  const [limit, setLimit] = useState<number>(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'paper'>('live');
  const [symbolQuery, setSymbolQuery] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'live') {
        const qs = new URLSearchParams();
        if (status !== 'all') qs.set('status', status);
        if (limit) qs.set('limit', String(limit));
        const url = qs.toString() ? `/api/delta/orders?${qs.toString()}` : '/api/delta/orders';
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'orders failed');
        const list = Array.isArray(json.result) ? json.result : Array.isArray(json.result?.result) ? json.result.result : [];

        const mapped: UiOrderRow[] = list.map((o: any) => ({
          id: String(o?.id || o?.order_id || o?.client_order_id || o?.client_oid || o?.clientOid || '—'),
          symbol: pickSymbol(o),
          side: pickSide(o),
          type: pickType(o),
          status: pickStatus(o),
          price: pickPrice(o),
          qty: pickQty(o),
          createdAtMs: pickCreatedAt(o),
        }));

        setRows(mapped);
      } else {
        const bRes = await fetch('/api/bots', { cache: 'no-store' }).then((r) => r.json());
        if (!bRes?.ok) throw new Error(bRes?.error || 'bots failed');
        const bots: BotRecord[] = Array.isArray(bRes.bots) ? bRes.bots : [];
        const orders = bots
          .filter((b) => ((b.config as any).execution || 'paper') === 'paper')
          .flatMap((b) => (Array.isArray((b as any).runtime?.orders) ? (b as any).runtime.orders : []))
          .filter((o: any) => o && (o.execution === 'paper' || o.execution === undefined));

        const mapped: UiOrderRow[] = orders.map((o: any) => ({
          id: String(o?.id || '—'),
          symbol: String(o?.symbol || '—'),
          side: pickSide(o),
          type: String(o?.order_type || 'market'),
          status: String(o?.status || 'filled'),
          error: o?.error ? String(o.error) : undefined,
          price: toNum(o?.price),
          qty: toNum(o?.size),
          createdAtMs: toNum(o?.createdAtMs),
          trigger:
            o?.triggerLevelPrice && o?.triggerDirection && o?.prevPrice && o?.currentPrice
              ? `${String(o.triggerDirection).toUpperCase()} lvl ${Number(o.triggerLevelPrice).toLocaleString(undefined, { maximumFractionDigits: 8 })} · ${Number(o.prevPrice).toLocaleString(undefined, { maximumFractionDigits: 8 })}→${Number(o.currentPrice).toLocaleString(undefined, { maximumFractionDigits: 8 })}`
              : undefined,
        }));
        setRows(mapped.slice(0, limit));
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'orders failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, limit, mode]);

  const sorted = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase();
    const filtered = q ? rows.filter((r) => String(r.symbol || '').toUpperCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  }, [rows, symbolQuery]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Home</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Orders</h1>
      <p className="mt-2 text-sm text-slate-600">
        {mode === 'live' ? 'Live orders from Delta Exchange (via server-side proxy).' : 'Paper orders from bot runtime snapshots.'}
      </p>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Orders"
            subtitle={error ? `Error: ${error}` : `Showing ${sorted.length} orders`}
            right={
              <div className="flex items-center gap-2">
                <input
                  value={symbolQuery}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                  placeholder="Search symbol (e.g. ETHUSD)"
                  className="w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  aria-label="Search symbol"
                />
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  aria-label="Mode"
                >
                  <option value="live">LIVE</option>
                  <option value="paper">PAPER</option>
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  aria-label="Order status filter"
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                </select>
                <select
                  value={String(limit)}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  aria-label="Order limit"
                >
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  Refresh
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
                    <th className="px-5 py-3 text-left font-medium">Order ID</th>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-left font-medium">Side</th>
                    <th className="px-5 py-3 text-left font-medium">Type</th>
                    <th className="px-5 py-3 text-right font-medium">Qty</th>
                    <th className="px-5 py-3 text-right font-medium">Price</th>
                    {mode === 'paper' ? <th className="px-5 py-3 text-left font-medium">Trigger</th> : null}
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((r) => (
                    <tr key={`${r.id}-${r.symbol}-${r.createdAtMs || 0}`} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {r.createdAtMs ? new Date(r.createdAtMs).toLocaleString() : '—'}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-700">{r.id}</td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="px-5 py-4">
                        {r.side === '—' ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <Badge tone={r.side === 'buy' ? 'green' : 'red'}>{r.side.toUpperCase()}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-4 text-slate-700">{r.type}</td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.qty === undefined ? '—' : r.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.price === undefined ? '—' : r.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </td>
                      {mode === 'paper' ? (
                        <td className="px-5 py-4 text-xs text-slate-500">
                          {r.trigger || '—'}
                        </td>
                      ) : null}
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <Badge tone={toneForStatus(r.status)}>{r.status}</Badge>
                          {mode === 'paper' && r.error ? (
                            <div className="text-xs text-red-600">{r.error}</div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {sorted.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={mode === 'paper' ? 9 : 8}>
                        {loading ? 'Loading…' : error ? 'No data (check API Integration & permissions).' : 'No orders found.'}
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


