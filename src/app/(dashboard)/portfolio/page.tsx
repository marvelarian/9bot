'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { BotRecord } from '@/lib/bots/types';

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
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [equityMode, setEquityMode] = useState<'live' | 'paper'>('live');
  const [equity, setEquity] = useState<{ label: string; series: number[] } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [wRes, pRes, bRes] = await Promise.all([
        fetch('/api/delta/wallet', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/delta/positions', { cache: 'no-store' }).then((r) => r.json()),
        // Portfolio includes deleted bots for performance history.
        fetch('/api/bots?includeDeleted=1', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (!wRes?.ok) throw new Error(wRes?.error || 'wallet failed');
      if (!pRes?.ok) throw new Error(pRes?.error || 'positions failed');
      setWallet(Array.isArray(wRes.result) ? wRes.result : []);
      setPositions(Array.isArray(pRes.result) ? pRes.result : []);
      setBots(bRes?.ok && Array.isArray(bRes.bots) ? bRes.bots : []);
    } catch (e: any) {
      setError(e?.message || 'portfolio failed');
      setWallet([]);
      setPositions([]);
      setBots([]);
    } finally {
      setLoading(false);
    }
  };

  const loadEquity = async (mode: 'live' | 'paper') => {
    try {
      const res = await fetch(`/api/equity/history?mode=${encodeURIComponent(mode)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || 'equity history failed');
      const series = Array.isArray(json.series) ? json.series : [];
      setEquity({ label: String(json.label || '—'), series });

      // Show warning if paper mode has no data (likely bot worker not enabled)
      if (mode === 'paper' && series.length === 0) {
        console.warn('Paper equity chart is empty. Ensure BOT_WORKER_ENABLED=true in your environment variables.');
      }
    } catch (error) {
      console.error(`Failed to load ${mode} equity:`, error);
      setEquity({ label: '—', series: [] });
    }
  };

  useEffect(() => {
    void load();
    void loadEquity(equityMode);
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void loadEquity(equityMode);
    const t = setInterval(() => void loadEquity(equityMode), 15_000);
    return () => clearInterval(t);
  }, [equityMode]);

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

  const botPnlRows = useMemo(() => {
    const rows = (bots || []).map((b) => {
      const exec = (((b.config as any).execution || 'paper') as 'paper' | 'live');
      const sym = String(b.config.symbol || '').toUpperCase();
      const isDeleted = typeof (b as any).deletedAt === 'number' && Number.isFinite((b as any).deletedAt);
      const investmentInr = toNum((b.config as any)?.investment) ?? null;
      const delSnap = (b.runtime as any)?.deletedSnapshot;
      const deletedPnlInr = isDeleted ? (toNum(delSnap?.pnlInr) ?? null) : null;
      const deletedRoePct = isDeleted ? (toNum(delSnap?.roePct) ?? null) : null;
      const paper = exec === 'paper' ? (toNum((b.runtime as any)?.paperStats?.realizedPnl) ?? 0) : null;
      const live = exec === 'live' ? (toNum((b.runtime as any)?.liveStats?.realizedPnl) ?? null) : null;
      return {
        id: b.id,
        name: b.name,
        exec,
        sym,
        isDeleted,
        investmentInr,
        // For deleted bots, show frozen per-symbol snapshot PnL (INR).
        pnlInr: isDeleted ? deletedPnlInr : null,
        roePct: isDeleted ? deletedRoePct : null,
        realized: exec === 'paper' ? paper : live,
        updatedAt: (b.runtime as any)?.liveStats?.updatedAt ?? b.runtime?.updatedAt ?? (b as any)?.deletedAt,
      };
    });
    // Show running first, then by updatedAt
    return rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }, [bots]);

  const equitySeries = equity?.series || [];
  const equityLabel = equity?.label || '—';
  const equityLast = equitySeries.length ? equitySeries[equitySeries.length - 1] : null;
  const equityFirst = equitySeries.length ? equitySeries[0] : null;
  const equityChange = equityLast !== null && equityFirst !== null ? equityLast - equityFirst : null;

  const EquityChart = ({ series }: { series: number[] }) => {
    const W = 800;
    const H = 220;
    const pad = 18;
    const raw = series.filter((v) => typeof v === 'number' && Number.isFinite(v));
    // If history is very long, downsample for SVG performance while still showing the full timespan.
    const MAX_RENDER = 2000;
    const vals =
      raw.length <= MAX_RENDER
        ? raw
        : (() => {
            const step = Math.ceil(raw.length / MAX_RENDER);
            const out: number[] = [];
            for (let i = 0; i < raw.length; i += step) out.push(raw[i]!);
            // Ensure last point is included
            if (out[out.length - 1] !== raw[raw.length - 1]) out.push(raw[raw.length - 1]!);
            return out;
          })();
    if (!vals.length) {
      return <div className="p-6 text-sm text-slate-500">No equity history yet.</div>;
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const denom = Math.max(1e-9, max - min);
    const x = (i: number) => pad + (i / Math.max(1, vals.length - 1)) * (W - pad * 2);
    const y = (v: number) => pad + ((max - v) / denom) * (H - pad * 2);
    const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full">
          <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" />
        </svg>
      </div>
    );
  };

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
        <Card className="lg:col-span-3">
          <CardHeader
            title="Equity chart"
            subtitle="Stored history (worker updates 24/7 on EC2). Toggle Live/Paper."
            right={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEquityMode('live')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    equityMode === 'live' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  Live
                </button>
                <button
                  type="button"
                  onClick={() => setEquityMode('paper')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    equityMode === 'paper' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  Paper
                </button>
              </div>
            }
          />
          <CardBody>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <EquityChart series={equitySeries} />
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Label</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{equityLabel}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Current</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {equityLast === null ? '—' : equityLast.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Change</div>
                  <div className={`mt-1 text-lg font-semibold ${equityChange !== null && equityChange >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {equityChange === null ? '—' : `${equityChange >= 0 ? '+' : ''}${equityChange.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Live = total account balance (wallet + unrealized P&L). Paper = simulated equity (initial capital + realized + unrealized P&L) across paper bots.
                  <br />
                  {equityMode === 'paper' && equitySeries.length === 0 && <span className="text-amber-600">⚠️ No paper data? Ensure BOT_WORKER_ENABLED=true.</span>}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

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
          <CardHeader title="Bot realized PnL" subtitle="Per-bot (paper from engine; live best-effort from fills)" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Bot</th>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-left font-medium">Mode</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Investment (INR)</th>
                    <th className="px-5 py-3 text-right font-medium">PnL (INR)</th>
                    <th className="px-5 py-3 text-right font-medium">ROE%</th>
                    <th className="px-5 py-3 text-right font-medium">Realized PnL (live/paper)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {botPnlRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 font-semibold text-slate-900">{r.name}</td>
                      <td className="px-5 py-4 text-slate-700">{r.sym || '—'}</td>
                      <td className="px-5 py-4">
                        <Badge tone={r.exec === 'live' ? 'red' : 'slate'}>{r.exec.toUpperCase()}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        {r.isDeleted ? <Badge tone="slate">Deleted</Badge> : <Badge tone="green">Active</Badge>}
                      </td>
                      <td className="px-5 py-4 text-right text-slate-700">
                        {r.investmentInr === null ? '—' : r.investmentInr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-5 py-4 text-right font-semibold ${r.pnlInr !== null && r.pnlInr >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {r.pnlInr === null ? '—' : `${r.pnlInr >= 0 ? '+' : ''}${r.pnlInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                      </td>
                      <td className={`px-5 py-4 text-right font-semibold ${r.roePct !== null && r.roePct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {r.roePct === null ? '—' : `${r.roePct >= 0 ? '+' : ''}${r.roePct.toFixed(2)}%`}
                      </td>
                      <td className={`px-5 py-4 text-right font-semibold ${r.realized !== null && r.realized >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {r.realized === null ? '—' : `${r.realized >= 0 ? '+' : ''}${r.realized.toLocaleString(undefined, { maximumFractionDigits: 8 })}`}
                      </td>
                    </tr>
                  ))}
                  {botPnlRows.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={9}>
                        No bots found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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


