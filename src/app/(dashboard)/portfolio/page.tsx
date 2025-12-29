'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

type WalletRow = { asset_symbol: string; balance: string; balance_inr?: string; available_balance?: string; available_balance_inr?: string };

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default function PortfolioPage() {
  const [wallet, setWallet] = useState<WalletRow[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [wRes, pRes] = await Promise.all([
        fetch('/api/delta/wallet', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/delta/positions', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (!wRes?.ok) throw new Error(wRes?.error || 'wallet failed');
      if (!pRes?.ok) throw new Error(pRes?.error || 'positions failed');
      setWallet(Array.isArray(wRes.result) ? wRes.result : []);
      setPositions(Array.isArray(pRes.result) ? pRes.result : []);
    } catch (e: any) {
      setError(e?.message || 'portfolio failed');
      setWallet([]);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const walletSummary = useMemo(() => {
    let inr = 0;
    let hasInr = false;
    const by: Record<string, number> = {};
    for (const w of wallet as any[]) {
      const sym = String(w?.asset_symbol || '');
      const bal = toNum(w?.balance);
      if (sym && bal !== null) by[sym] = (by[sym] || 0) + bal;
      const bi = toNum(w?.balance_inr);
      if (bi !== null) {
        inr += bi;
        hasInr = true;
      }
    }
    const sym = by.USDC ? 'USDC' : by.USD ? 'USD' : by.INR ? 'INR' : '—';
    const val = sym === '—' ? 0 : by[sym];
    return { by, inr: hasInr ? inr : null, fallback: { sym, val } };
  }, [wallet]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Home</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Portfolio</h1>
          <p className="mt-2 text-sm text-slate-600">Wallet + positions from Delta (auto-refresh every ~15s).</p>
        </div>
        <div className="flex items-center gap-2">
          {error ? <Badge tone="red">Error</Badge> : loading ? <Badge tone="slate">Loading</Badge> : <Badge tone="green">Live</Badge>}
          <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Wallet balances" subtitle="Delta /wallet/balances" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Asset</th>
                    <th className="px-5 py-3 text-right font-medium">Balance</th>
                    <th className="px-5 py-3 text-right font-medium">Available</th>
                    <th className="px-5 py-3 text-right font-medium">INR (if provided)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wallet.map((w) => (
                    <tr key={w.asset_symbol} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 font-semibold text-slate-900">{w.asset_symbol}</td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {Number(w.balance).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {w.available_balance ? Number(w.available_balance).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {w.balance_inr ? Number(w.balance_inr).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                      </td>
                    </tr>
                  ))}

                  {wallet.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={4}>
                        {loading ? 'Loading…' : error ? `Error: ${error}` : 'No wallet data'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Summary" subtitle="Best-effort totals" />
          <CardBody className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Total (INR, if available)</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {walletSummary.inr === null ? '—' : `${walletSummary.inr.toLocaleString(undefined, { maximumFractionDigits: 2 })} INR`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Fallback total</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {walletSummary.fallback.sym === '—'
                  ? '—'
                  : `${walletSummary.fallback.val.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${walletSummary.fallback.sym}`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Open positions</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{positions.length}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Open positions" subtitle="Delta /positions/margined" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-right font-medium">Size</th>
                    <th className="px-5 py-3 text-right font-medium">Entry</th>
                    <th className="px-5 py-3 text-right font-medium">Unrealized PnL</th>
                    <th className="px-5 py-3 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {positions.map((p: any, idx: number) => {
                    const sym = String(p?.product_symbol || p?.symbol || p?.product?.symbol || p?.symbol || '—');
                    const size = toNum(p?.size ?? p?.position_size ?? p?.net_quantity);
                    const entry = toNum(p?.entry_price ?? p?.avg_entry_price ?? p?.average_entry_price);
                    const upnl = toNum(p?.unrealized_pnl ?? p?.unrealizedPnl);
                    const margin = toNum(p?.position_margin ?? p?.margin);
                    return (
                      <tr key={`${sym}-${idx}`} className="hover:bg-slate-50/60">
                        <td className="px-5 py-4 font-semibold text-slate-900">{sym}</td>
                        <td className="px-5 py-4 text-right text-slate-700">{size === null ? '—' : size.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td className="px-5 py-4 text-right text-slate-700">{entry === null ? '—' : entry.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                        <td className={`px-5 py-4 text-right font-semibold ${upnl !== null && upnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {upnl === null ? '—' : `${upnl >= 0 ? '+' : ''}${upnl.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}
                        </td>
                        <td className="px-5 py-4 text-right text-slate-700">{margin === null ? '—' : margin.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      </tr>
                    );
                  })}

                  {positions.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={5}>
                        {loading ? 'Loading…' : error ? `Error: ${error}` : 'No open positions'}
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


