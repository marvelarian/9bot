'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/charts/Sparkline';
import { getBots, refreshBots, updateBot, type BotRecord } from '@/lib/bot-store';
import { formatPrice, convertPnlToInr } from '@/lib/format';
import { Bot, Plus, RefreshCcw } from 'lucide-react';

type TopMover = { symbol: string; last?: number; changePct: number };

function toUpper(s: any) {
  return String(s || '').trim().toUpperCase();
}

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickPosSymbol(p: any): string {
  return toUpper(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? p?.productSymbol ?? '');
}

function pickPosSizeAbs(p: any): number {
  const sizeRaw =
    toNum(p?.size) ??
    toNum(p?.position_size) ??
    toNum(p?.quantity) ??
    toNum(p?.net_quantity) ??
    toNum(p?.net_size) ??
    toNum(p?.position_qty) ??
    0;
  const n = typeof sizeRaw === 'number' ? sizeRaw : 0;
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function fmtDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export default function DashboardHomePage() {
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [wallet, setWallet] = useState<Array<{ asset_symbol: string; balance: string }>>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [equitySeries, setEquitySeries] = useState<number[]>([]);
  const [equityLabel, setEquityLabel] = useState<string>('—');
  const [botPrices, setBotPrices] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [topMovers, setTopMovers] = useState<{ gainers: TopMover[]; losers: TopMover[] } | null>(null);

  const streamsRef = useRef(new Map<string, EventSource>());
  const lastEquityRef = useRef<number | null>(null);
  const lastEquityAlertRef = useRef<number>(0);

  useEffect(() => {
    const fromCache = () => setBots(getBots());
    void refreshBots()
      .then(() => fromCache())
      .catch(() => fromCache());
    window.addEventListener('bots:changed', fromCache);
    return () => window.removeEventListener('bots:changed', fromCache);
  }, []);

  useEffect(() => {
    // Backfill startedAt for bots that were already running before we introduced runtime.startedAt.
    for (const b of bots) {
      if (!b.isRunning) continue;
      if (typeof b.runtime?.startedAt === 'number' && Number.isFinite(b.runtime.startedAt)) continue;
      // We don't know the true start time for legacy running bots; best-effort fallback.
      const fallback = typeof b.runtime?.updatedAt === 'number' ? b.runtime.updatedAt : b.updatedAt || Date.now();
      void updateBot(b.id, { runtime: { startedAt: fallback } }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots.length]);

  useEffect(() => {
    // Timer for running duration display (only needed if any bot is running)
    if (!bots.some((b) => b.isRunning)) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [bots]);

  // Local equity history (client-side)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/equity/history', { cache: 'no-store' });
        const json = await res.json();
        if (!json?.ok) return;
        if (!alive) return;
        const arr = Array.isArray(json.series) ? json.series.filter((n: any) => typeof n === 'number' && Number.isFinite(n)) : [];
        setEquitySeries(arr.slice(-60));
        if (typeof json.label === 'string') setEquityLabel(json.label);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/delta/top-movers?limit=5', { cache: 'no-store' });
        const json = await res.json();
        if (!json?.ok) return;
        if (!alive) return;
        setTopMovers({ gainers: json.gainers || [], losers: json.losers || [] });
      } catch {
        // ignore
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    // Live prices for bot symbols (SSE), limited to the first 6 bots to avoid too many connections.
    const keys = Array.from(
      new Set(
        bots
          .slice(0, 6)
          .map((b) => {
            const sym = (b.config.symbol || '').trim().toUpperCase();
            const ex = ((b.config as any).exchange || 'delta_india') as any;
            return sym ? `${ex}:${sym}` : null;
          })
          .filter(Boolean) as string[]
      )
    );
    keys.forEach((k) => {
      const [ex, sym] = k.split(':');
      const streamKey = `bot:${ex}:${sym}`;
      if (streamsRef.current.has(streamKey)) return;
      const es = new EventSource(`/api/prices/stream?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(ex)}&intervalMs=1000`);
      streamsRef.current.set(streamKey, es);
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (typeof data?.markPrice === 'number') {
            const p = data.markPrice as number;
            setBotPrices((prev) => ({ ...prev, [`${ex}:${sym}`]: p }));
          }
        } catch {}
      };
    });

    return () => {
      // Clean up bot:* streams that are no longer needed
      const staleKeys: string[] = [];
      streamsRef.current.forEach((es, key) => {
        if (!key.startsWith('bot:')) return;
        const id = key.slice('bot:'.length); // ex:sym
        if (!keys.includes(id)) {
          es.close();
          staleKeys.push(key);
        }
      });
      for (const key of staleKeys) streamsRef.current.delete(key);
    };
  }, [bots]);

  const refreshWallet = async () => {
    try {
      const res = await fetch('/api/delta/wallet', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setWallet(Array.isArray(json.result) ? json.result : []);
    } catch {
      // ignore
    }
  };

  const refreshPositions = async () => {
    try {
      const res = await fetch('/api/delta/positions', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setPositions(Array.isArray(json.result) ? json.result : []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshWallet();
    refreshPositions();
    const t = setInterval(() => {
      refreshWallet();
      refreshPositions();
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => {
      streamsRef.current.forEach((es) => es.close());
      streamsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const walletDisplay = useMemo(() => {
    const by: Record<string, number> = {};
    for (const b of wallet) {
      const n = Number(b.balance);
      if (!Number.isFinite(n)) continue;
      by[b.asset_symbol] = (by[b.asset_symbol] || 0) + n;
    }
    const sym = by.USDC ? 'USDC' : by.USD ? 'USD' : by.INR ? 'INR' : '—';
    const val = sym === '—' ? 0 : by[sym];
    return { sym, val, by };
  }, [wallet]);

  const equityNow = useMemo(() => {
    // Best-effort “equity”:
    // - Prefer INR if Delta provides *_inr fields (India environment often does).
    // - Else fall back to walletDisplay.val for USDC/USD/INR (no FX conversion).
    let inr = 0;
    let hasInr = false;
    for (const b of wallet as any[]) {
      const n = Number(b?.balance_inr);
      if (Number.isFinite(n)) {
        inr += n;
        hasInr = true;
      }
    }

    // If positions provide unrealized pnl in INR, include it (only when present).
    if (hasInr) {
      for (const p of positions as any[]) {
        const up = Number(p?.unrealized_pnl_inr);
        if (Number.isFinite(up)) inr += up;
      }
      return { value: inr, label: 'INR' };
    }

    return { value: walletDisplay.val, label: walletDisplay.sym };
  }, [positions, wallet, walletDisplay.sym, walletDisplay.val]);

  useEffect(() => {
    // Persist a rolling equity series for the sparkline.
    try {
      if (equityNow.label === '—') return;
      setEquityLabel(equityNow.label);

      setEquitySeries((prev) => {
        const next = [...prev, equityNow.value].slice(-120);
        // server-side persistence (best-effort)
        fetch('/api/equity/history', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: equityNow.label, value: equityNow.value }),
        }).catch(() => null);
        return next.slice(-60);
      });
    } catch {
      // ignore
    }
  }, [equityNow.label, equityNow.value]);

  useEffect(() => {
    // Wallet/equity alerts (rate-limited) – useful for margin changes, deposits/withdrawals, etc.
    try {
      if (equityNow.label === '—') return;
      const prev = lastEquityRef.current;
      lastEquityRef.current = equityNow.value;
      if (prev === null) return;

      const diff = equityNow.value - prev;
      const abs = Math.abs(diff);
      const nowTs = Date.now();
      const minIntervalMs = 60_000;
      const threshold = 0.01; // small, but avoids float noise
      if (abs < threshold) return;
      if (nowTs - lastEquityAlertRef.current < minIntervalMs) return;
      lastEquityAlertRef.current = nowTs;

      fetch('/api/alerts/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: [
            `<b>9BOT</b> — Wallet change`,
            `<b>Equity:</b> ${equityNow.value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${equityNow.label}`,
            `<b>Δ:</b> ${diff >= 0 ? '+' : ''}${diff.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${equityNow.label}`,
            `<b>Time:</b> ${new Date(nowTs).toISOString()}`,
          ].join('\n'),
        }),
      }).catch(() => null);
    } catch {
      // ignore
    }
  }, [equityNow.label, equityNow.value]);

  const runningBots = bots.filter((b) => b.isRunning).length;

  const riskSummary = useMemo(() => {
    // Aggregate across ALL bots.
    // - Red: any running bot is at/over max loss OR at/over circuit breaker
    // - Amber: any bot was stopped by risk recently, or close to max loss/cb, or at max positions
    // - Green: none of the above
    const now = Date.now();
    const riskStopWindowMs = 24 * 60 * 60 * 1000;

    // Build exchange position maps (LIVE only)
    const unrealBySym: Record<string, number> = {};
    const openCountBySym: Record<string, number> = {};
    for (const p of positions as any[]) {
      const sym = pickPosSymbol(p);
      if (!sym) continue;
      const upInr = toNum(p?.unrealized_pnl_inr);
      if (upInr !== null) unrealBySym[sym] = (unrealBySym[sym] || 0) + upInr;
      const sz = pickPosSizeAbs(p);
      if (sz > 0) openCountBySym[sym] = (openCountBySym[sym] || 0) + 1;
    }

    let stoppedByRisk = 0;
    let runningAtCb = 0;
    let runningNearCb = 0;
    let runningAtMaxPos = 0;
    let worstRoe: number | null = null;

    for (const b of bots) {
      const cfg: any = b.config || {};
      const exec = ((cfg.execution || 'paper') as 'paper' | 'live');
      const sym = toUpper(cfg.symbol);

      const riskReason = String((b as any)?.runtime?.riskStopReason || '').trim();
      const riskAt = toNum((b as any)?.runtime?.riskStoppedAt);
      if (riskReason && riskAt !== null && now - riskAt <= riskStopWindowMs) stoppedByRisk += 1;

      if (!b.isRunning) continue;

      // Loss streak risk disabled (strategy exits are profit-only)

      // Max positions pressure (LIVE: exchange positions count; PAPER: runtime positions)
      const maxPos = Number(cfg.maxPositions) || 0;
      const openCount =
        exec === 'live'
          ? (openCountBySym[sym] || 0)
          : Array.isArray((b as any)?.runtime?.positions)
            ? ((b as any).runtime.positions as any[]).length
            : 0;
      if (maxPos > 0 && openCount >= maxPos) runningAtMaxPos += 1;

      // Circuit breaker proximity (Option A): ROE% based on investment INR and symbol PnL INR.
      const cb = Number(cfg.circuitBreaker) || 0;
      const inv = toNum(cfg.investment) ?? toNum((b as any)?.runtime?.startedEquity) ?? null;
      if (exec === 'live' && cb > 0 && inv !== null && inv > 0 && sym) {
        const realized = toNum((b as any)?.runtime?.liveStats?.realizedPnl) ?? 0;
        const unreal = unrealBySym[sym] || 0;
        const pnl = realized + unreal;
        const roe = (pnl / inv) * 100;
        if (Number.isFinite(roe)) {
          worstRoe = worstRoe === null ? roe : Math.min(worstRoe, roe);
          if (roe <= -cb) runningAtCb += 1;
          else if (roe <= -cb * 0.8) runningNearCb += 1;
        }
      }
    }

    let tone: 'green' | 'amber' | 'red' = 'green';
    let title = 'Healthy';
    let subtitle = 'No breakers';

    if (runningAtCb > 0) {
      tone = 'red';
      title = 'Risk';
      subtitle = `${runningAtCb ? `${runningAtCb} circuit` : ''}`;
    } else if (stoppedByRisk > 0 || runningNearCb > 0 || runningAtMaxPos > 0) {
      tone = 'amber';
      title = 'Warning';
      subtitle = `${stoppedByRisk ? `${stoppedByRisk} risk-stopped` : ''}${stoppedByRisk && (runningNearCb || runningAtMaxPos) ? ' · ' : ''}${
        runningNearCb ? `${runningNearCb} near-circuit` : ''
      }${runningNearCb && runningAtMaxPos ? ' · ' : ''}${runningAtMaxPos ? `${runningAtMaxPos} at-maxPos` : ''}`;
    }

    return {
      tone,
      title,
      subtitle,
      worstRoe,
      counts: { stoppedByRisk, runningAtCb, runningNearCb, runningAtMaxPos },
    };
  }, [bots, positions]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Home</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Overview</h1>
          <p className="mt-2 text-sm text-slate-600">
            Wallet, bots, market watch, and activity — designed like a modern trading dashboard.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/bot/create">
            <Button>
              <Plus className="h-4 w-4" />
              New bot
            </Button>
          </Link>
          <Button variant="secondary" onClick={refreshWallet}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Wallet</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {walletDisplay.sym === '—'
                ? 'Not connected'
                : `${walletDisplay.val.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${walletDisplay.sym}`}
            </div>
            <div className="mt-2 text-xs text-slate-500">Live via Delta wallet API</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Bots running</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{runningBots}</div>
            <div className="mt-2 text-xs text-slate-500">Out of {bots.length} bots</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Equity curve</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {equityNow.label === '—' ? '—' : `${equityNow.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${equityNow.label}`}
            </div>
            <div className="mt-2">
              <Sparkline data={equitySeries.length ? equitySeries : [equityNow.value || 0]} width={180} height={42} stroke="#0f172a" fill="rgba(15,23,42,0.06)" />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Risk status</div>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={riskSummary.tone === 'red' ? 'red' : riskSummary.tone === 'amber' ? 'yellow' : 'green'}>{riskSummary.title}</Badge>
              <span className="text-sm font-semibold text-slate-900">{riskSummary.subtitle || '—'}</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {riskSummary.worstRoe === null ? (
                'Based on running bots (loss streak, circuit breaker, max positions).'
              ) : (
                <>Worst ROE (running LIVE): {riskSummary.worstRoe.toFixed(2)}%</>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Market watch */}
        <Card className="lg:col-span-2">
          <CardHeader title="Market watch" subtitle="Watchlist + Top 5 movers (Delta India)" />
          <CardBody className="p-0">
            <div className="grid gap-4 p-5 md:grid-cols-3">
              <div className="grid gap-3 md:col-span-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="text-xs font-semibold text-slate-900">Top 5 Gainers</div>
                    <div className="text-[11px] text-slate-500">Crypto only</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(topMovers?.gainers || []).map((m) => (
                      <div key={m.symbol} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div>
                          <div className="font-semibold text-slate-900">{m.symbol}</div>
                          <div className="text-[11px] text-slate-500">
                            Price: {formatPrice(m.last)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-emerald-700 font-semibold">{m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(2)}%</div>
                          <div className="text-[11px] text-slate-500">24h</div>
                        </div>
                      </div>
                    ))}
                    {!topMovers?.gainers?.length ? (
                      <div className="px-4 py-4 text-sm text-slate-500">—</div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="text-xs font-semibold text-slate-900">Top 5 Losers</div>
                    <div className="text-[11px] text-slate-500">Crypto only</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(topMovers?.losers || []).map((m) => (
                      <div key={m.symbol} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div>
                          <div className="font-semibold text-slate-900">{m.symbol}</div>
                          <div className="text-[11px] text-slate-500">
                            Price: {formatPrice(m.last)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-rose-700 font-semibold">{m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(2)}%</div>
                          <div className="text-[11px] text-slate-500">24h</div>
                        </div>
                      </div>
                    ))}
                    {!topMovers?.losers?.length ? (
                      <div className="px-4 py-4 text-sm text-slate-500">—</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Bots */}
        <Card>
          <CardHeader title="Your bots" subtitle="Running status, live price, and account PnL snapshot" />
          <CardBody className="space-y-3">
            {bots.length ? (
              bots.slice(0, 5).map((b) => (
                <Link
                  key={b.id}
                  href={`/grid-status?bot=${encodeURIComponent(b.id)}`}
                  className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{b.name}</div>
                        <div className="text-xs text-slate-500">{b.config.symbol} · {b.config.mode}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.isRunning ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
                      {(() => {
                        const exec = ((b.config as any).execution || 'paper') as 'paper' | 'live';
                        return exec === 'live' ? <Badge tone="red">LIVE</Badge> : <Badge tone="slate">PAPER</Badge>;
                      })()}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-slate-500">Price</div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {(() => {
                          const sym = (b.config.symbol || '').trim().toUpperCase();
                          const ex = ((b.config as any).exchange || 'delta_india') as any;
                          const p = botPrices[`${ex}:${sym}`];
                          return p === undefined ? '—' : `$${formatPrice(p)}`;
                        })()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-slate-500">Duration</div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {b.isRunning && typeof b.runtime?.startedAt === 'number' ? fmtDuration(Date.now() - b.runtime.startedAt) : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-slate-500">Investment</div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {(() => {
                          const inv = toNum((b.config as any)?.investment) ?? toNum((b as any)?.runtime?.startedEquity) ?? null;
                          if (inv === null || inv <= 0) return '—';
                          return `INR ${inv.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                        })()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-slate-500">ROE%</div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {(() => {
                          const inv = toNum((b.config as any)?.investment) ?? toNum((b as any)?.runtime?.startedEquity) ?? null;
                          if (inv === null || inv <= 0) return '—';

                          const exec = (((b.config as any).execution || 'paper') as 'paper' | 'live');
                          const sym = toUpper(b.config.symbol);
                          const ex = ((b.config as any).exchange || 'delta_india') as any;

                          // Unrealized (LIVE) from Delta positions (account-level), filtered by symbol.
                          let unrealInr: number | null = null;
                          if (exec === 'live') {
                            let sum = 0;
                            let sawInr = false;
                            for (const p of positions as any[]) {
                              const ps = toUpper(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? p?.productSymbol);
                              if (!ps || ps !== sym) continue;
                              const upInr = toNum(p?.unrealized_pnl_inr);
                              if (upInr !== null) {
                                sum += upInr;
                                sawInr = true;
                              } else {
                                const up = toNum(p?.unrealized_pnl ?? p?.unrealizedPnl);
                                if (up !== null && !sawInr) sum += convertPnlToInr(up) ?? 0;
                              }
                            }
                            unrealInr = sum;
                          }

                          // Realized (LIVE) from worker liveStats (best-effort). PAPER from paperStats.
                          const realizedRaw =
                            exec === 'live'
                              ? (toNum((b as any)?.runtime?.liveStats?.realizedPnl) ?? 0)
                              : (toNum((b as any)?.runtime?.paperStats?.realizedPnl) ?? 0);
                          const realizedInr = convertPnlToInr(realizedRaw) ?? 0;

                          // PAPER unrealized (best-effort) from runtime positions + current price when available.
                          if (exec === 'paper') {
                            const curP = botPrices[`${ex}:${sym}`];
                            if (curP === undefined) return '—';
                            const pos = Array.isArray((b as any).runtime?.positions) ? ((b as any).runtime.positions as any[]) : [];
                            let unreal = 0;
                            for (const p of pos) {
                              const qty = toNum(p?.quantity) ?? 0;
                              const entry = toNum(p?.entryPrice);
                              const side = String(p?.side || '').toLowerCase();
                              if (!qty || entry === null) continue;
                              unreal += side === 'sell' ? (entry - curP) * qty : (curP - entry) * qty;
                            }
                            // IMPORTANT: use REALIZED PnL only for equity/ROE baseline. Unrealized is informational.
                            const pct = (realizedInr / inv) * 100;
                            const cls = pct >= 0 ? 'text-emerald-700' : 'text-rose-700';
                            return <span className={cls} title="ROE% vs Investment (PAPER)">{`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}</span>;
                          }

                          if (unrealInr === null) return '—';
                          // IMPORTANT: use REALIZED PnL only for equity/ROE baseline. Unrealized is informational.
                          const pct = (realizedInr / inv) * 100;
                          const cls = pct >= 0 ? 'text-emerald-700' : 'text-rose-700';
                          return (
                            <span className={cls} title="ROE% vs Investment (INR): realized only (LIVE)">
                              {`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-sm text-slate-500">No bots yet. Create your first one.</div>
            )}

            <Link href="/bot/control">
              <Button className="w-full" variant="secondary">Open control panel</Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}



