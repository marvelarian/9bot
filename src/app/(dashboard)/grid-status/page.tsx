'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { GridLevel } from '@/lib/types';
import { deleteBot, getBots, refreshBots, updateBot, type BotRecord } from '@/lib/bot-store';
import { fetchEquitySnapshot } from '@/lib/equity';
import { formatPrice, convertPnlToInr } from '@/lib/format';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pause, Play, Trash2 } from 'lucide-react';

interface GridStatusData {
  symbol: string;
  levels: GridLevel[];
  currentPrice: number;
  mode: string;
  totalPnL: number;
}

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

function normSym(s: any): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function symMatches(a: any, b: any): boolean {
  const x = normSym(a);
  const y = normSym(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function pickSide(f: any): 'buy' | 'sell' | null {
  const s = String(f?.side || f?.order_side || f?.direction || '').toLowerCase();
  return s === 'buy' || s === 'sell' ? (s as any) : null;
}

function pickPosSide(p: any): 'buy' | 'sell' | null {
  const s = String(p?.side ?? p?.position_side ?? p?.direction ?? p?.order_side ?? '').toLowerCase();
  if (s === 'buy' || s === 'long') return 'buy';
  if (s === 'sell' || s === 'short') return 'sell';
  const sizeRaw =
    toNum(p?.size) ??
    toNum(p?.position_size) ??
    toNum(p?.quantity) ??
    toNum(p?.net_quantity) ??
    toNum(p?.net_size) ??
    toNum(p?.position_qty) ??
    undefined;
  if (typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw !== 0) return sizeRaw > 0 ? 'buy' : 'sell';
  return null;
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
  const n = Number(sizeRaw);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function pickQty(f: any): number | undefined {
  return toNum(f?.size ?? f?.quantity ?? f?.qty ?? f?.filled_size);
}

function pickPrice(f: any): number | undefined {
  return toNum(f?.price ?? f?.fill_price ?? f?.avg_fill_price ?? f?.average_fill_price);
}

function pickRealizedPnl(f: any): number | undefined {
  return toNum(
    f?.realized_pnl ??
      f?.realizedPnl ??
      f?.pnl ??
      f?.profit ??
      f?.trade_pnl ??
      f?.realized_pnl_inr ??
      f?.realized_pnl_usd ??
      f?.realized_pnl_usdc
  );
}

export default function GridStatusPage() {
  const params = useSearchParams();
  const selectedId = params.get('bot');
  const [bot, setBot] = useState<BotRecord | null>(null);
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [liveEquity, setLiveEquity] = useState<{ value: number; label: string; at: number; error?: string } | null>(null);
  const [symbolUnrealizedInr, setSymbolUnrealizedInr] = useState<number | null>(null);
  const [symbolOpenStats, setSymbolOpenStats] = useState<{ count: number; buys: number; sells: number } | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [fillsStats, setFillsStats] = useState<{
    sinceMs: number | null;
    total: number;
    buys: number;
    sells: number;
    buyQty: number;
    sellQty: number;
    avgBuy?: number;
    avgSell?: number;
    realizedPnl?: number;
    winTrades?: number;
    lossTrades?: number;
    winRate?: number;
    lastFillMs?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const refreshFromCache = () => {
      const all = getBots();
      setBots(all);
      const chosen = selectedId ? all.find((b) => b.id === selectedId) : all[0];
      setBot(chosen || null);
    };
    // initial load from server
    void refreshBots().then(() => refreshFromCache()).catch(() => refreshFromCache());
    const handler = () => refreshFromCache();
    window.addEventListener('bots:changed', handler);
    return () => window.removeEventListener('bots:changed', handler);
  }, [selectedId]);

  useEffect(() => {
    if (!bot) return;
    // live price from SSE
    const ex = ((bot.config as any).exchange || 'delta_india') as any;
    const es = new EventSource(
      `/api/prices/stream?symbol=${encodeURIComponent(bot.config.symbol)}&exchange=${encodeURIComponent(ex)}&intervalMs=1000`
    );
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (typeof data?.markPrice === 'number') setCurrentPrice(data.markPrice);
      } catch {}
    };
    return () => es.close();
  }, [bot?.id]);

  const levels = useMemo(() => {
    if (!bot) return [];
    // Prefer runtime snapshot from running bot (accurate active/inactive + lastCrossed)
    if (bot.runtime?.levels?.length) return bot.runtime.levels as any as GridLevel[];

    // Otherwise compute static grid from config
    const cfg = bot.config;
    const spacing = (cfg.upperRange - cfg.lowerRange) / (cfg.numberOfGrids - 1);
    return Array.from({ length: cfg.numberOfGrids }).map((_, i) => ({
      id: `grid-${i}`,
      price: Number((cfg.lowerRange + i * spacing).toFixed(8)),
      isActive: true,
      tradeCount: 0,
    }));
  }, [bot]);

  // IMPORTANT: Hooks must run on every render. Do not early-return before hooks.
  const cfg = bot?.config || {
    exchange: 'delta_india' as const,
    execution: 'paper' as const,
    symbol: '',
    lowerRange: 0,
    upperRange: 1,
    numberOfGrids: 2,
    mode: 'long' as const,
    investment: 0,
    quantity: 0,
    leverage: 1,
    maxPositions: 0,
    maxConsecutiveLoss: 0,
    circuitBreaker: 0,
  };

  const live = bot ? currentPrice ?? bot.runtime?.lastPrice ?? null : null;
  const selectedLevel = selectedLevelId ? levels.find((l) => l.id === selectedLevelId) || null : null;

  const chartLevels = useMemo(() => {
    if (!levels.length) return [];
    const anchor = typeof live === 'number' && Number.isFinite(live) ? live : (cfg.lowerRange + cfg.upperRange) / 2;
    return [...levels]
      .sort((a, b) => Math.abs(a.price - anchor) - Math.abs(b.price - anchor))
      .slice(0, 5)
      .sort((a, b) => a.price - b.price);
  }, [cfg.lowerRange, cfg.upperRange, levels, live]);

  const activeLevels = levels.filter((l) => l.isActive);
  const inactiveLevels = levels.filter((l) => !l.isActive);
  const totalLevelTrades = levels.reduce((sum, level) => sum + (level.tradeCount || 0), 0);

  const exec = (((cfg as any).execution || 'paper') as 'paper' | 'live');
  const startedAt = typeof bot?.runtime?.startedAt === 'number' ? bot.runtime.startedAt : null;
  const sessionMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
  const tradesPerHour =
    sessionMs && sessionMs > 0 ? (totalLevelTrades / (sessionMs / 3600000)) : null;

  const lotSize =
    typeof bot?.runtime?.lotSize === 'number' && Number.isFinite(bot.runtime.lotSize) ? bot.runtime.lotSize : Number((cfg as any).lotSize) || 1;
  const contractValue =
    typeof bot?.runtime?.contractValue === 'number' && Number.isFinite(bot.runtime.contractValue)
      ? bot.runtime.contractValue
      : Number((cfg as any).contractValue) || 1;
  const lots = Number(cfg.quantity);
  const contractsPerOrder = Number.isFinite(lots) ? Math.floor(lots) * Math.floor(lotSize) : null;

  const investmentInrRaw = Number((cfg as any)?.investment);
  const investmentInr =
    Number.isFinite(investmentInrRaw) && investmentInrRaw > 0
      ? investmentInrRaw
      : (typeof bot?.runtime?.startedEquity === 'number' && Number.isFinite(bot.runtime.startedEquity) ? bot.runtime.startedEquity : 0);
  // IMPORTANT: use REALIZED PnL only for equity / drawdown calculations.
  // Unrealized PnL is displayed separately as informational.
  const realizedInr = typeof fillsStats?.realizedPnl === 'number' && Number.isFinite(fillsStats.realizedPnl) ? fillsStats.realizedPnl : 0;
  const unrealizedInr = typeof symbolUnrealizedInr === 'number' && Number.isFinite(symbolUnrealizedInr) ? symbolUnrealizedInr : 0;
  const pnlInr = exec === 'live' ? realizedInr : 0;
  const ddPct = investmentInr > 0 ? (pnlInr / investmentInr) * 100 : null;

  const mostTraded = useMemo(() => {
    if (!levels.length) return null;
    let best: GridLevel | null = null;
    for (const l of levels) {
      const tc = l.tradeCount || 0;
      if (!best || tc > (best.tradeCount || 0)) best = l;
    }
    if (!best || !(best.tradeCount || 0)) return null;
    return best;
  }, [levels]);
  const nearestLevel = useMemo(() => {
    if (!levels.length || typeof live !== 'number' || !Number.isFinite(live)) return null;
    let best: GridLevel | null = null;
    for (const l of levels) {
      if (!best || Math.abs(l.price - live) < Math.abs(best.price - live)) best = l;
    }
    return best;
  }, [levels, live]);

  const openPositions = useMemo(() => {
    const list = Array.isArray(bot?.runtime?.positions) ? (bot?.runtime?.positions as any[]) : [];
    return list.filter((p) => p && typeof p.quantity === 'number' && Number.isFinite(p.quantity) && p.quantity !== 0);
  }, [bot?.runtime?.positions]);
  const paperOpenCount = openPositions.length;
  const paperOpenBuys = openPositions.filter((p) => p.side === 'buy').length;
  const paperOpenSells = openPositions.filter((p) => p.side === 'sell').length;
  const openCount = exec === 'live' ? (symbolOpenStats?.count ?? 0) : paperOpenCount;
  const openBuys = exec === 'live' ? (symbolOpenStats?.buys ?? 0) : paperOpenBuys;
  const openSells = exec === 'live' ? (symbolOpenStats?.sells ?? 0) : paperOpenSells;

  const estUnrealizedPnl = useMemo(() => {
    if (!(typeof live === 'number' && Number.isFinite(live))) return null;
    let sum = 0;
    for (const p of openPositions) {
      const qty = Number(p.quantity);
      const entry = Number(p.entryPrice);
      if (!Number.isFinite(qty) || !Number.isFinite(entry) || qty === 0) continue;
      const pnl = p.side === 'sell' ? (entry - live) * qty : (live - entry) * qty;
      sum += pnl;
    }
    return Number.isFinite(sum) ? sum : null;
  }, [live, openPositions]);

  useEffect(() => {
    // Best-effort trade/fill stats (only meaningful for LIVE execution, and still account-level).
    // We filter by symbol and (when possible) since bot startedAt.
    if (!bot) return;
    if (exec !== 'live') {
      setFillsStats(null);
      setSymbolUnrealizedInr(null);
      setSymbolOpenStats(null);
      return;
    }
    const ex = ((bot.config as any).exchange || 'delta_india') as any;
    const symbol = (bot.config.symbol || '').trim().toUpperCase();
    if (!symbol) {
      setFillsStats(null);
      return;
    }
    let alive = true;

    const load = async () => {
      try {
        const startedAt = typeof bot.runtime?.startedAt === 'number' ? bot.runtime.startedAt : null;
        const qs = new URLSearchParams();
        qs.set('exchange', String(ex));
        qs.set('symbol', symbol);
        qs.set('product_symbol', symbol);
        qs.set('limit', '1000');
        if (startedAt) qs.set('start_time', String(Math.floor(startedAt / 1000)));
        const res = await fetch(`/api/delta/fills?${qs.toString()}`, { cache: 'no-store' });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || 'fills failed');
        const list = Array.isArray(json.result) ? json.result : Array.isArray(json.result?.result) ? json.result.result : [];

        let total = 0;
        let buys = 0;
        let sells = 0;
        let buyQty = 0;
        let sellQty = 0;
        let buyNotional = 0;
        let sellNotional = 0;
        let realizedPnl: number | undefined = undefined;
        let winTrades: number | undefined = undefined;
        let lossTrades: number | undefined = undefined;
        let lastFillMs: number | undefined = undefined;

        for (const f of list) {
          const sym = String(f?.product_symbol || f?.symbol || f?.product?.symbol || '').trim().toUpperCase();
          if (sym && !symMatches(sym, symbol)) continue;
          const t = parseTsMs(f?.created_at ?? f?.createdAt ?? f?.timestamp ?? f?.time);
          if (startedAt && t && t < startedAt) continue;
          const side = pickSide(f);
          const qty = pickQty(f);
          const price = pickPrice(f);
          if (t && (!lastFillMs || t > lastFillMs)) lastFillMs = t;
          total += 1;
          if (side === 'buy') {
            buys += 1;
            if (qty !== undefined) buyQty += qty;
            if (qty !== undefined && price !== undefined) buyNotional += qty * price;
          } else if (side === 'sell') {
            sells += 1;
            if (qty !== undefined) sellQty += qty;
            if (qty !== undefined && price !== undefined) sellNotional += qty * price;
          }
          // Prefer INR realized PnL fields when present (Delta India), else fallback.
          const rpInr = toNum((f as any)?.realized_pnl_inr);
          const rp = rpInr !== undefined ? rpInr : pickRealizedPnl(f);
          if (rp !== undefined) {
            realizedPnl = (realizedPnl || 0) + rp;
            if (winTrades === undefined) winTrades = 0;
            if (lossTrades === undefined) lossTrades = 0;
            if (rp > 0) winTrades += 1;
            else if (rp < 0) lossTrades += 1;
          }
        }

        const denom = (winTrades || 0) + (lossTrades || 0);
        const winRate = denom > 0 ? (winTrades || 0) / denom : undefined;

        const next = {
          sinceMs: startedAt,
          total,
          buys,
          sells,
          buyQty,
          sellQty,
          avgBuy: buyQty > 0 ? buyNotional / buyQty : undefined,
          avgSell: sellQty > 0 ? sellNotional / sellQty : undefined,
          realizedPnl,
          winTrades,
          lossTrades,
          winRate,
          lastFillMs,
        };
        if (!alive) return;
        setFillsStats(next);
      } catch (e: any) {
        if (!alive) return;
        setFillsStats({
          sinceMs: typeof bot.runtime?.startedAt === 'number' ? bot.runtime.startedAt : null,
          total: 0,
          buys: 0,
          sells: 0,
          buyQty: 0,
          sellQty: 0,
          error: e?.message || 'fills failed',
        });
      }
    };

    const loadPositions = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('exchange', String(ex));
        const res = await fetch(`/api/delta/positions?${qs.toString()}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!json?.ok) throw new Error(json?.error || 'positions failed');
        const list = Array.isArray(json.result) ? json.result : Array.isArray(json.result?.result) ? json.result.result : [];
        const sym = symbol;
        let sum = 0;
        let count = 0;
        let buys = 0;
        let sells = 0;
        for (const p of list as any[]) {
          const ps = String(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? '').trim().toUpperCase();
          if (!ps || !symMatches(ps, sym)) continue;
          const sz = pickPosSizeAbs(p);
          if (sz > 0) {
            count += 1;
            const side = pickPosSide(p);
            if (side === 'buy') buys += 1;
            else if (side === 'sell') sells += 1;
          }
          const upInr = toNum(p?.unrealized_pnl_inr ?? p?.unrealizedPnlInr);
          const upFallback = toNum(p?.unrealized_pnl ?? p?.unrealizedPnl);
          const up = upInr !== undefined ? upInr : (upFallback !== undefined ? convertPnlToInr(upFallback) : undefined);
          if (typeof up === 'number' && Number.isFinite(up)) sum += up;
        }
        if (!alive) return;
        setSymbolUnrealizedInr(sum);
        setSymbolOpenStats({ count, buys, sells });
      } catch {
        if (!alive) return;
        setSymbolUnrealizedInr(null);
        setSymbolOpenStats(null);
      }
    };

    void load();
    void loadPositions();
    const t = setInterval(load, bot.isRunning ? 15_000 : 30_000);
    const t2 = setInterval(loadPositions, bot.isRunning ? 15_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(t2);
    };
  }, [bot?.id, bot?.isRunning, bot?.runtime?.startedAt]);

  useEffect(() => {
    // LIVE equity snapshot for showing current drawdown vs started equity (UI-only; requires logged-in session).
    if (!bot) return;
    if (exec !== 'live') {
      setLiveEquity(null);
      return;
    }
    const ex = ((bot.config as any).exchange || 'delta_india') as any;
    let alive = true;
    const load = async () => {
      try {
        const snap = await fetchEquitySnapshot(ex);
        if (!alive) return;
        setLiveEquity({ value: snap.value, label: snap.label, at: Date.now() });
      } catch (e: any) {
        if (!alive) return;
        setLiveEquity((prev) => ({
          value: prev?.value ?? 0,
          label: prev?.label ?? '—',
          at: Date.now(),
          error: e?.message || 'equity failed',
        }));
      }
    };
    void load();
    const t = setInterval(load, bot.isRunning ? 15_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bot?.id, bot?.isRunning, exec]);

  // After all hooks are declared, it is safe to early-return.
  if (!bot) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="text-center py-12">
          <p className="mt-4 text-gray-600">No bot found. Create a bot first.</p>
        </div>
      </div>
    );
  }

  const toggle = async () => {
    if (!bot.isRunning) {
      const sym = (bot.config.symbol || '').trim().toUpperCase();
      const ex = ((bot.config as any).exchange || 'delta_india') as any;
      const conflict = bots.find(
        (x) =>
          x.id !== bot.id &&
          x.isRunning &&
          ((x.config as any).exchange || 'delta_india') === ex &&
          (x.config.symbol || '').trim().toUpperCase() === sym
      );
      if (conflict) {
        alert(`A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}. Stop it first (bot: ${conflict.name}).`);
        return;
      }
      try {
        const next = await updateBot(bot.id, {
          isRunning: true,
          runtime: {
            startedAt: Date.now(),
            startedEquity: Number((bot.config as any)?.investment) || 0,
            startedCurrency: 'INR',
          },
        });
        if (!next) {
          alert(`A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}. Stop it first.`);
        }
        return;
      } catch {
        // fall through
      }
    }
    const next = await updateBot(bot.id, { isRunning: !bot.isRunning });
    if (!next && !bot.isRunning) {
      const sym = (bot.config.symbol || '').trim().toUpperCase();
      const ex = ((bot.config as any).exchange || 'delta_india') as any;
      alert(`A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}. Stop it first.`);
      return;
    }
    // local state will update via bots:changed event
  };

  const remove = () => {
    void deleteBot(bot.id).catch(() => null);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Grid Status</h1>
        <p className="text-gray-600">Connected to Delta ticker and your bot configuration</p>
      </div>

      {/* Current Price Indicator */}
      <Card className="mb-6">
        <CardBody className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Bot</div>
            <div className="text-xl font-semibold text-slate-900">{bot.name}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
              <span><strong>Symbol:</strong> {cfg.symbol}</span>
              <span>·</span>
              <span><strong>Mode:</strong> {cfg.mode}</span>
              <span>·</span>
              <span><strong>Execution:</strong> {(((cfg as any).execution || 'paper') as string).toUpperCase()}</span>
              <span>·</span>
              <span><strong>Exchange:</strong> {(((cfg as any).exchange || 'delta_india') as string) === 'delta_global' ? 'Delta Global' : 'Delta India'}</span>
              <span>·</span>
              <span><strong>Range:</strong> ${cfg.lowerRange.toLocaleString()} → ${cfg.upperRange.toLocaleString()}</span>
              <span>·</span>
              <span><strong>Grids:</strong> {cfg.numberOfGrids}</span>
              <span>·</span>
              <span>
                <strong>Spacing:</strong>{' '}
                {Number.isFinite(Number((cfg as any).gridSpacing))
                  ? formatPrice(Number((cfg as any).gridSpacing))
                  : formatPrice((cfg.upperRange - cfg.lowerRange) / Math.max(1, cfg.numberOfGrids - 1))}
                {typeof (cfg as any).gridSpacingPctAtCreate === 'number' && Number.isFinite((cfg as any).gridSpacingPctAtCreate)
                  ? ` (${Number((cfg as any).gridSpacingPctAtCreate).toFixed(2)}% @ ${typeof (cfg as any).refPriceAtCreate === 'number' && Number.isFinite((cfg as any).refPriceAtCreate) ? formatPrice(Number((cfg as any).refPriceAtCreate)) : '—'})`
                  : ''}
              </span>
              <span>·</span>
              <span><strong>Investment:</strong> {Number((cfg as any).investment || 0).toLocaleString()} INR</span>
              <span>·</span>
              <span><strong>Lots:</strong> {cfg.quantity}</span>
              <span>·</span>
              <span><strong>Lot size:</strong> {lotSize}</span>
              <span>·</span>
              <span><strong>Contracts/order:</strong> {contractsPerOrder ?? '—'}</span>
              <span>·</span>
              <span><strong>Leverage:</strong> {cfg.leverage}x</span>
              <span>·</span>
              <span><strong>Max positions:</strong> {cfg.maxPositions}</span>
              <span>·</span>
              <span><strong>Circuit breaker:</strong> {cfg.circuitBreaker}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="text-slate-500">Circuit breaker</div>
                <div className="mt-1 font-semibold text-slate-900">
                  {Number(cfg.circuitBreaker) > 0 ? `${cfg.circuitBreaker}%` : 'Off'}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Triggers on % drawdown from started equity (REALIZED PnL only). Works for LIVE + PAPER.
                  {Number(cfg.circuitBreaker) > 100 ? ' (This value is unusually high; recommended 0–100.)' : ''}
                </div>
                <div className="mt-2 text-[11px] text-slate-600">
                  Current DD:{' '}
                  {ddPct === null ? (
                    '—'
                  ) : (
                    <span className={ddPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                      {ddPct >= 0 ? '+' : ''}
                      {ddPct.toFixed(2)}%
                    </span>
                  )}
                  {exec === 'live' && investmentInr > 0 ? (
                    <span className="text-slate-500">
                      {' '}
                      · INR {(investmentInr + pnlInr).toLocaleString(undefined, { maximumFractionDigits: 2 })} /{' '}
                      {investmentInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {' '}
                      · Realized PnL INR {pnlInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {typeof unrealizedInr === 'number' && Number.isFinite(unrealizedInr) ? (
                        <span> · Unrealized INR {unrealizedInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="text-slate-500">Last risk stop</div>
                <div className="mt-1 font-semibold text-slate-900">{bot.runtime?.riskStopReason || '—'}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {typeof bot.runtime?.riskStoppedAt === 'number' ? new Date(bot.runtime.riskStoppedAt).toLocaleString() : '—'}
                </div>
              </div>
            </div>
            {bots.length > 1 ? (
              <div className="mt-3 text-xs text-slate-500">
                Tip: open a specific bot with <span className="font-mono">/grid-status?bot=BOT_ID</span>
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Live price (Delta)</div>
            <div className="text-3xl font-bold text-slate-900">
              {live === null ? '—' : `$${formatPrice(live)}`}
            </div>
            <div className="mt-2">
              <div className="flex flex-wrap justify-end gap-2">
                {bot.isRunning ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
                {(((cfg as any).execution || 'paper') as 'paper' | 'live') === 'live' ? (
                  <Badge tone="red">LIVE</Badge>
                ) : (
                  <Badge tone="slate">PAPER</Badge>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant={bot.isRunning ? 'danger' : 'primary'} onClick={toggle}>
                {bot.isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {bot.isRunning ? 'Stop bot' : 'Start bot'}
              </Button>
              <Button variant="secondary" onClick={remove}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Grid Chart */}
      <Card className="mb-6">
        <CardHeader
          title="Grid chart"
          subtitle="Interactive grid lines + live price (hover a level for details)"
          right={
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-xs text-slate-500">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSelectedLevelId(null)}>
                Clear
              </Button>
            </div>
          }
        />
        <CardBody>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <svg viewBox="0 0 800 360" className="h-full w-full">
                  {(() => {
                    const W = 800;
                    const H = 360;
                    const padX = 60;
                    const padY = 24;
                    const plotW = W - padX - 24;
                    const plotH = H - padY * 2;
                    const minLvl = Math.min(...chartLevels.map((l) => l.price));
                    const maxLvl = Math.max(...chartLevels.map((l) => l.price));
                    const anchor = typeof live === 'number' && Number.isFinite(live) ? live : (cfg.lowerRange + cfg.upperRange) / 2;
                    const min = Number.isFinite(minLvl) ? Math.min(minLvl, anchor) : cfg.lowerRange;
                    const max = Number.isFinite(maxLvl) ? Math.max(maxLvl, anchor) : cfg.upperRange;
                    const range = Math.max(1e-9, max - min);
                    const pad = (range * 0.35) / Math.max(1, zoom);
                    const ymin = min - pad;
                    const ymax = max + pad;
                    const denom = Math.max(1e-9, ymax - ymin);
                    const y = (price: number) => padY + ((ymax - price) / denom) * plotH;

                    const liveY = live === null ? null : y(live);

                    return (
                      <>
                        {/* axes */}
                        <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#e2e8f0" strokeWidth={2} />
                        <line x1={padX} y1={H - padY} x2={W - 24} y2={H - padY} stroke="#e2e8f0" strokeWidth={2} />

                        {/* grid levels (nearest 5) */}
                        {chartLevels.map((lvl) => {
                          const yy = y(lvl.price);
                          const selected = selectedLevelId === lvl.id;
                          const stroke = lvl.isActive ? '#10b981' : '#f43f5e';
                          return (
                            <g
                              key={lvl.id}
                              onMouseEnter={() => setSelectedLevelId(lvl.id)}
                              onFocus={() => setSelectedLevelId(lvl.id)}
                              role="button"
                              tabIndex={0}
                              style={{ cursor: 'pointer' }}
                            >
                              <line
                                x1={padX}
                                y1={yy}
                                x2={W - 24}
                                y2={yy}
                                stroke={stroke}
                                strokeOpacity={selected ? 0.95 : 0.45}
                                strokeWidth={selected ? 3 : 2}
                              />
                              {/* label */}
                              <text x={10} y={yy + 4} fontSize="12" fill="#0f172a" opacity={selected ? 1 : 0.6}>
                                {formatPrice(lvl.price)}
                              </text>
                            </g>
                          );
                        })}

                        {/* live price */}
                        {liveY !== null ? (
                          <>
                            <line x1={padX} y1={liveY} x2={W - 24} y2={liveY} stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                            <circle cx={W - 28} cy={liveY} r={5} fill="#2563eb" />
                            <rect x={W - 180} y={Math.max(8, liveY - 18)} width={152} height={26} rx={10} fill="#2563eb" opacity={0.12} />
                            <text x={W - 170} y={Math.max(26, liveY)} fontSize="12" fill="#1d4ed8">
                              Live: {formatPrice(live)}
                            </text>
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                </svg>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Showing the nearest 5 grid levels around the current price. Green = active, red = inactive.
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-700">Selection</div>
                <div className="mt-2 text-sm text-slate-700">
                  {selectedLevel ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Price</span>
                        <span className="font-semibold text-slate-900">${formatPrice(selectedLevel.price)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Status</span>
                        {selectedLevel.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">{exec === 'live' ? 'Signals' : 'Trades'}</span>
                        <span className="font-semibold text-slate-900">{selectedLevel.tradeCount || 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Last crossed</span>
                        <span className="font-semibold text-slate-900">
                          {('lastCrossed' in selectedLevel ? selectedLevel.lastCrossed : undefined) || '—'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500">Hover a level in the chart.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold text-slate-700">Quick stats</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Active</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{activeLevels.length}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Inactive</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{inactiveLevels.length}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">{exec === 'live' ? 'Fills' : 'Trades'}</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {exec === 'live' ? (fillsStats?.total ?? 0) : totalLevelTrades}
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">{exec === 'live' ? 'Most triggered level' : 'Most traded level'}</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {mostTraded ? `$${formatPrice(mostTraded.price)} · ${mostTraded.tradeCount || 0}` : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Nearest level</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {nearestLevel && typeof live === 'number' ? `$${formatPrice(nearestLevel.price)}` : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Active %</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {levels.length ? `${Math.round((activeLevels.length / levels.length) * 100)}%` : '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Open positions</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {openCount} / {cfg.maxPositions}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Buys / Sells</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {openBuys} / {openSells}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-slate-500">Unrealized PnL (est.)</div>
                    <div
                      className={`mt-1 font-semibold ${
                        (exec === 'live' ? symbolUnrealizedInr : estUnrealizedPnl) === null
                          ? 'text-slate-900'
                          : (exec === 'live' ? (symbolUnrealizedInr as number) : (estUnrealizedPnl as number)) >= 0
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {(exec === 'live' ? symbolUnrealizedInr : estUnrealizedPnl) === null
                        ? '—'
                        : (exec === 'live'
                            ? `INR ${(symbolUnrealizedInr as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                            : (estUnrealizedPnl as number).toLocaleString(undefined, { maximumFractionDigits: 8 }))}
                    </div>
                  </div>
                </div>

                {exec === 'paper' ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-700">Paper performance (simulated)</div>
                      <Badge tone="slate">PAPER</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(() => {
                        const lev = Number(cfg.leverage);
                        const lots = Number(cfg.quantity);
                        const contracts = Number.isFinite(lots) ? Math.floor(lots) * Math.floor(lotSize) : NaN;
                        const cv = Number(contractValue) || 1;
                        const notionalMultiplier = contracts * cv;
                        const startP = toNum(bot.runtime?.startedPrice ?? bot.runtime?.paperStartedPrice);
                        const curP = typeof live === 'number' && Number.isFinite(live) ? live : null;
                        const ps = (bot as any).runtime?.paperStats;
                        const closedTrades = typeof ps?.closedTrades === 'number' ? ps.closedTrades : 0;
                        const profitTrades = typeof ps?.profitTrades === 'number' ? ps.profitTrades : 0;
                        const lossTrades = typeof ps?.lossTrades === 'number' ? ps.lossTrades : 0;
                        const denom = profitTrades + lossTrades;
                        const winRate = typeof ps?.winRate === 'number' ? ps.winRate : denom > 0 ? profitTrades / denom : null;
                        const realizedPnl = typeof ps?.realizedPnl === 'number' ? ps.realizedPnl : null;

                        const hasAnyPaperTrades = closedTrades > 0 || profitTrades > 0 || lossTrades > 0;
                        const hasBaseline =
                          Number.isFinite(notionalMultiplier) &&
                          notionalMultiplier > 0 &&
                          typeof startP === 'number' &&
                          curP !== null &&
                          startP > 0;

                        const updatedAt = typeof bot.runtime?.updatedAt === 'number' ? bot.runtime.updatedAt : null;
                        const ageMs = updatedAt ? Date.now() - updatedAt : null;
                        const staleWhileRunning = bot.isRunning && (ageMs === null || ageMs > 15_000);

                        const initial = hasBaseline ? notionalMultiplier * (startP as number) : null;
                        const currentVal = hasBaseline ? notionalMultiplier * (curP as number) : null;
                        const pnl = hasBaseline
                          ? cfg.mode === 'short'
                            ? (initial as number) - (currentVal as number)
                            : (currentVal as number) - (initial as number)
                          : null;

                        // For PAPER execution, use realized PnL instead of mark-to-market for consistency with home page
                        const pnlForPct = exec === 'paper' && realizedPnl !== null ? realizedPnl : pnl;
                        const pnlPct = hasBaseline && initial && initial > 0 && pnlForPct !== null ? (pnlForPct / initial) * 100 : null;

                        return (
                          <>
                            {staleWhileRunning ? (
                              <div className="col-span-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                                Bot is marked <strong>Running</strong>, but runtime is not updating.
                                <div className="mt-1 text-[11px] text-amber-700">
                                  This usually means the EC2 worker isn’t running, or <code>BOT_WORKER_OWNER_EMAIL</code> does not match the email that owns this bot.
                                  Ensure <code>BOT_WORKER_ENABLED=true</code> and restart your server/PM2.
                                </div>
                              </div>
                            ) : null}

                            {!hasBaseline ? (
                              <div className="col-span-3 text-slate-500">
                                Waiting for baseline price from the server worker…
                                <div className="mt-1 text-[11px] text-slate-500">
                                  When the worker runs, it will set <code>startedPrice</code> automatically (no need to keep this page open).
                                </div>
                              </div>
                            ) : null}

                      <div>
                        <div className="text-slate-500">Realized PnL</div>
                        <div className="font-semibold text-slate-900" title="P&L from completed trades only">
                          {realizedPnl === null
                            ? '—'
                            : realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </div>
                      </div>
                            <div>
                              <div className="text-slate-500">Win rate</div>
                              <div className="font-semibold text-slate-900">
                                {winRate === null ? '—' : `${(winRate * 100).toFixed(1)}%`}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500">Closed trades</div>
                              <div className="font-semibold text-slate-900">{closedTrades}</div>
                            </div>

                            <div>
                              <div className="text-slate-500">Profit trades</div>
                              <div className="font-semibold text-slate-900">{profitTrades}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Loss trades</div>
                              <div className="font-semibold text-slate-900">{lossTrades}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">PnL%</div>
                              <div className={`font-semibold ${pnlPct !== null && pnlPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {pnlPct === null ? '—' : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
                              </div>
                            </div>

                            <div>
                              <div className="text-slate-500">Simulated trades</div>
                              <div className="font-semibold text-slate-900">{totalLevelTrades}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Trades / hour</div>
                              <div className="font-semibold text-slate-900">
                                {tradesPerHour === null ? '—' : tradesPerHour.toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500">Duration</div>
                              <div className="font-semibold text-slate-900">{formatDuration(sessionMs)}</div>
                            </div>

                            <div className="col-span-3 mt-1 text-[11px] text-slate-500">
                              Worker heartbeat: {updatedAt ? `${Math.round((ageMs || 0) / 1000)}s ago` : '—'} · Baseline: {typeof startP === 'number' ? formatPrice(startP) : '—'}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      Simulated stats are computed from round-trip trades (entry → exit). Fees/slippage are not included.
                    </div>
                  </div>
                ) : null}

                {exec === 'live' && fillsStats ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-700">Live fills (best-effort)</div>
                      {fillsStats.error ? <Badge tone="yellow">Unavailable</Badge> : <Badge tone="blue">Delta</Badge>}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-slate-500">Fills</div>
                        <div className="font-semibold text-slate-900">{fillsStats.total}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Buys / Sells</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.buys} / {fillsStats.sells}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Last fill</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.lastFillMs ? new Date(fillsStats.lastFillMs).toLocaleTimeString() : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Win / Loss</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.winTrades === undefined || fillsStats.lossTrades === undefined
                            ? '—'
                            : `${fillsStats.winTrades} / ${fillsStats.lossTrades}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Win rate</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.winRate === undefined ? '—' : `${(fillsStats.winRate * 100).toFixed(1)}%`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Avg buy</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.avgBuy === undefined ? '—' : `$${formatPrice(fillsStats.avgBuy)}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Avg sell</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.avgSell === undefined ? '—' : `$${formatPrice(fillsStats.avgSell)}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Realized PnL</div>
                        <div className="font-semibold text-slate-900">
                          {fillsStats.realizedPnl === undefined
                            ? '—'
                            : (convertPnlToInr(fillsStats.realizedPnl) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      Filters fills by symbol{fillsStats.sinceMs ? ' since bot start time' : ''}. If you trade manually, these counts may include non-bot fills.
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Grid Logic Explanation */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">Grid Trading Logic</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
          <div>
            <strong>Level Activation:</strong> When price crosses a grid level, that level becomes inactive to prevent multiple entries during price oscillations.
          </div>
          <div>
            <strong>Level Reactivation:</strong> When price crosses any other level, previously inactive levels become active again.
          </div>
          <div>
            <strong>Long Mode:</strong> Buy orders placed when price crosses below grid levels, sell orders when crossing above (requires prior buy position).
          </div>
          <div>
            <strong>Short Mode:</strong> Sell orders placed when price crosses above grid levels, buy orders when crossing below (requires prior sell position).
          </div>
        </div>
      </div>
    </div>
  );
}

