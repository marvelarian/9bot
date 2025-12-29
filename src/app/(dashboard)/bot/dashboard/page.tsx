'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { GridBotEngine } from '@/lib/grid-bot-engine';
import { AlertSystem } from '@/lib/alert-system';
import type { Alert, GridBotConfig, GridBotStats } from '@/lib/types';
import { deleteBot, getBots, refreshBots, updateBot, type BotRecord } from '@/lib/bot-store';
import { fetchEquitySnapshot } from '@/lib/equity';
import { formatPrice } from '@/lib/format';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/charts/Sparkline';
import { Bell, Plus, Search, Settings, Zap } from 'lucide-react';

type TopMover = { symbol: string; last: number; changePct: number };
type HeaderTicker = { symbol: string; price?: number; changePct?: number };

interface BotInstance {
  id: string;
  name: string;
  config: GridBotConfig;
  engine: GridBotEngine;
  stats: GridBotStats;
  isRunning: boolean;
}

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickLast(t: any): number | null {
  return (
    toNum(t?.mark_price) ??
    toNum(t?.markPrice) ??
    toNum(t?.last_price) ??
    toNum(t?.lastPrice) ??
    toNum(t?.close) ??
    toNum(t?.close_price)
  );
}

function pickOpen(t: any): number | null {
  return toNum(t?.open) ?? toNum(t?.open_price) ?? toNum(t?.openPrice);
}

function pickChangePct(t: any): number | null {
  const direct =
    toNum(t?.price_change_percent) ??
    toNum(t?.price_change_pct) ??
    toNum(t?.change_pct) ??
    toNum(t?.changePercent) ??
    toNum(t?.change_24h) ??
    toNum(t?.percent_change_24h);
  if (direct !== null) return direct;
  const last = pickLast(t);
  const open = pickOpen(t);
  if (last !== null && open !== null && open !== 0) return ((last - open) / open) * 100;
  return null;
}

export default function BotDashboardPage() {
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBot, setSelectedBot] = useState<BotInstance | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertSystem] = useState(() => new AlertSystem());
  const [query, setQuery] = useState('');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<Array<{ asset_symbol: string; balance: string }>>([]);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [topMovers, setTopMovers] = useState<{ gainers: TopMover[]; losers: TopMover[] } | null>(null);
  const [topMoversError, setTopMoversError] = useState<string | null>(null);
  const [headerTickers, setHeaderTickers] = useState<Record<string, HeaderTicker>>({
    BTCUSD: { symbol: 'BTCUSD' },
    ETHUSD: { symbol: 'ETHUSD' },
  });

  const enginesRef = useRef(new Map<string, GridBotEngine>());
  const streamsRef = useRef(new Map<string, EventSource>());
  const fillsSeenRef = useRef(new Set<string>());
  const fillsPrimedRef = useRef(false);

  useEffect(() => {
    // Initialize alert system
    const unsubscribe = alertSystem.subscribe(() => {
      setAlerts(alertSystem.getAlerts(10));
    });

    return unsubscribe;
  }, [alertSystem]);

  useEffect(() => {
    // Poll engines for updated stats
    const t = setInterval(() => {
      setBots((prev) =>
        prev.map((b) => ({
          ...b,
          stats: b.engine.getStats(),
        }))
      );
      setSelectedBot((prev) => (prev ? { ...prev, stats: prev.engine.getStats() } : prev));
    }, 1500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Fills watcher (Telegram via AlertSystem): detect new fills for live bots and notify once.
    let alive = true;

    const makeKey = (ex: string, sym: string, f: any) => {
      const id = f?.id ?? f?.fill_id ?? f?.trade_id ?? f?.uuid;
      if (id) return `${ex}:${sym}:${id}`;
      const ts = f?.created_at ?? f?.timestamp ?? f?.time ?? '';
      const px = f?.price ?? f?.fill_price ?? '';
      const sz = f?.size ?? f?.qty ?? f?.quantity ?? '';
      const side = f?.side ?? '';
      return `${ex}:${sym}:${side}:${ts}:${px}:${sz}`;
    };

    const pick = (f: any) => {
      const symbol = String(f?.product_symbol || f?.symbol || f?.product?.symbol || '').toUpperCase();
      const side = String(f?.side || f?.order_side || '').toUpperCase();
      const price = Number(f?.price ?? f?.fill_price ?? f?.avg_price);
      const size = Number(f?.size ?? f?.quantity ?? f?.qty);
      const tsRaw = f?.created_at ?? f?.timestamp ?? f?.time;
      const ts = tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString();
      return { symbol, side, price, size, ts };
    };

    const poll = async () => {
      if (!alive) return;
      const liveBots = bots.filter((b) => b.isRunning && ((b.config as any).execution || 'paper') === 'live');
      if (!liveBots.length) return;

      // First poll seeds history without alerting (prevents dumping old fills).
      const shouldAlert = fillsPrimedRef.current;

      for (const b of liveBots) {
        const ex = ((b.config as any).exchange || 'delta_india') as any;
        const sym = (b.config.symbol || '').toUpperCase();
        try {
          const res = await fetch(`/api/delta/fills?exchange=${encodeURIComponent(ex)}&symbol=${encodeURIComponent(sym)}&limit=20`, {
            cache: 'no-store',
          });
          const json = await res.json();
          if (!json?.ok) continue;
          const arr = Array.isArray(json.result) ? json.result : [];
          for (const f of arr) {
            const key = makeKey(ex, sym, f);
            if (fillsSeenRef.current.has(key)) continue;
            fillsSeenRef.current.add(key);
            if (!shouldAlert) continue;
            const info = pick(f);
            alertSystem.createAlert(
              'position',
              `Fill ${info.side} ${info.size || ''} ${info.symbol || sym} @ ${Number.isFinite(info.price) ? formatPrice(info.price) : '—'} (${ex})`,
              'high',
              info.symbol || sym
            );
          }
        } catch {
          // ignore
        }
      }

      fillsPrimedRef.current = true;
    };

    // prime
    void poll();
    const t = setInterval(() => void poll(), 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [alertSystem, bots]);

  useEffect(() => {
    // Header: show BTCUSD/ETHUSD live price + 24h change from Delta ticker.
    let alive = true;
    const symbols = ['BTCUSD', 'ETHUSD'];

    const load = async () => {
      try {
        const results = await Promise.all(
          symbols.map(async (s) => {
            const res = await fetch(`/api/delta/ticker?symbol=${encodeURIComponent(s)}`, { cache: 'no-store' });
            const json = await res.json();
            if (!json?.ok) throw new Error(json?.error || 'ticker failed');
            const t = json.result ?? json;
            const price = pickLast(t);
            const changePct = pickChangePct(t);
            return { symbol: s, price: price ?? undefined, changePct: changePct ?? undefined };
          })
        );
        if (!alive) return;
        setHeaderTickers((prev) => {
          const next = { ...prev };
          for (const r of results) next[r.symbol] = r;
          return next;
        });
      } catch {
        // ignore; keep last known values
      }
    };

    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/delta/top-movers?limit=5', { cache: 'no-store' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'top movers failed');
        if (!alive) return;
        setTopMovers({ gainers: json.gainers || [], losers: json.losers || [] });
        setTopMoversError(null);
      } catch (e: any) {
        if (!alive) return;
        setTopMoversError(e?.message || 'top movers failed');
        setTopMovers(null);
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
    // Fetch wallet balances from server-side Delta proxy (requires env DELTA_API_KEY/DELTA_API_SECRET)
    const load = async () => {
      try {
        const res = await fetch('/api/delta/wallet', { cache: 'no-store' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'wallet failed');
        setWallet(Array.isArray(json.result) ? json.result : []);
        setWalletError(null);
      } catch (e: any) {
        setWalletError(e?.message || 'wallet failed');
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const makeEngine = (config: GridBotConfig) => {
    const exchange = {
      async getTicker(symbol: string) {
        return { markPrice: livePrices[symbol] ?? undefined };
      },
      async placeOrder(req: any) {
        const ex = (config as any).exchange || 'delta_india';
        const exec = (config as any).execution || 'paper';
        if (exec !== 'live') {
          alertSystem.createAlert('position', `Simulated ${req.side.toUpperCase()} order: ${config.symbol}`, 'medium', config.symbol);
          return { id: `mock-${Date.now()}` };
        }

        const res = await fetch('/api/delta/order', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            exchange: ex,
            symbol: req.symbol || config.symbol,
            side: req.side,
            order_type: req.order_type || 'market',
            size: req.size,
            price: req.price,
          }),
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || 'place order failed');
        alertSystem.createAlert('position', `LIVE ${req.side.toUpperCase()} order sent: ${config.symbol}`, 'high', config.symbol);
        return { id: json.id || json?.result?.id || `delta-${Date.now()}` };
      },
      async cancelOrder(orderId: string) {
        const ex = (config as any).exchange || 'delta_india';
        const exec = (config as any).execution || 'paper';
        if (exec !== 'live') return;
        await fetch(`/api/delta/order?orderId=${encodeURIComponent(orderId)}&exchange=${encodeURIComponent(ex)}`, {
          method: 'DELETE',
          cache: 'no-store',
        }).catch(() => null);
      },
      async getWalletBalances() {
        const ex = (config as any).exchange || 'delta_india';
        const res = await fetch(`/api/delta/wallet?exchange=${encodeURIComponent(ex)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!json?.ok) return [];
        return Array.isArray(json.result) ? json.result : [];
      },
    };
    return new GridBotEngine(config, exchange as any);
  };

  const loadBotsFromStore = () => {
    const records = getBots();

    const instances: BotInstance[] = records.map((r) => {
      let engine = enginesRef.current.get(r.id);
      if (!engine) {
        engine = makeEngine(r.config);
        enginesRef.current.set(r.id, engine);
      } else {
        engine.updateConfig(r.config);
      }
      const stats = engine.getStats();
      return {
        id: r.id,
        name: r.name,
        config: r.config,
        engine,
        stats,
        isRunning: r.isRunning,
      };
    });

    setBots(instances);
    return records;
  };

  useEffect(() => {
    const handler = () => {
      const records = loadBotsFromStore();
      setSelectedBot((prev) => {
        if (!prev) return prev;
        const rec = records.find((b) => b.id === prev.id);
        if (!rec) return prev;
        const eng = enginesRef.current.get(rec.id);
        if (!eng) return prev;
        return {
          ...prev,
          name: rec.name,
          config: rec.config,
          isRunning: rec.isRunning,
          stats: eng.getStats(),
        };
      });
    };
    window.addEventListener('bots:changed', handler);
    return () => window.removeEventListener('bots:changed', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // initial server load (fills cache) then render from cache
    const records = getBots();
    void refreshBots()
      .then(() => {
        const r = loadBotsFromStore();
        // Auto-select from query param if present
        const url = new URL(window.location.href);
        const selectedId = url.searchParams.get('selected');
        const chosen = selectedId ? r.find((b) => b.id === selectedId) : r[0];
        if (chosen) {
          const inst = enginesRef.current.get(chosen.id);
          setSelectedBot(
            inst
              ? {
                  id: chosen.id,
                  name: chosen.name,
                  config: chosen.config,
                  engine: inst,
                  stats: inst.getStats(),
                  isRunning: chosen.isRunning,
                }
              : null
          );
        }
      })
      .catch(() => {
        // fallback to cache-only
        const r = loadBotsFromStore();
        const url = new URL(window.location.href);
        const selectedId = url.searchParams.get('selected');
        const chosen = selectedId ? r.find((b) => b.id === selectedId) : r[0];
        if (chosen) {
          const inst = enginesRef.current.get(chosen.id);
          setSelectedBot(
            inst
              ? {
                  id: chosen.id,
                  name: chosen.name,
                  config: chosen.config,
                  engine: inst,
                  stats: inst.getStats(),
                  isRunning: chosen.isRunning,
                }
              : null
          );
        }
      });
    // Auto-select from query param if present
    void records;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Ensure every running bot has a price stream, and stopped bots don't.
    bots.forEach((b) => {
      const has = streamsRef.current.has(b.id);
      if (b.isRunning && !has) {
        const ex = ((b.config as any).exchange || 'delta_india') as any;
        const es = new EventSource(
          `/api/prices/stream?symbol=${encodeURIComponent(b.config.symbol)}&exchange=${encodeURIComponent(ex)}&intervalMs=1000`
        );
        streamsRef.current.set(b.id, es);

        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (typeof data?.markPrice === 'number') {
              const p = data.markPrice as number;
              setLivePrices((prev) => ({ ...prev, [b.config.symbol]: p }));
              void b.engine.processPriceUpdate(p).catch(() => null);

              // persist runtime snapshot so Grid Status page matches this bot
              const levels = b.engine.getGridLevels();
              void updateBot(b.id, {
                runtime: {
                  lastPrice: p,
                  updatedAt: Date.now(),
                  levels: levels.map((l) => ({
                    id: l.id,
                    price: l.price,
                    isActive: l.isActive,
                    lastCrossed: l.lastCrossed,
                    tradeCount: l.tradeCount,
                  })),
                },
              }).catch(() => null);
            }
          } catch {}
        };
      }
      if (!b.isRunning && has) {
        const es = streamsRef.current.get(b.id);
        es?.close();
        streamsRef.current.delete(b.id);
      }
    });

    // cleanup any streams for deleted bots
    const staleIds: string[] = [];
    streamsRef.current.forEach((es, id) => {
      if (!bots.some((b) => b.id === id)) {
        es.close();
        staleIds.push(id);
      }
    });
    for (const id of staleIds) streamsRef.current.delete(id);
  }, [bots]);

  const totalEquity = useMemo(() => {
    // We display a simple “wallet total” in the settlement currency if available.
    // For a true equity number across assets, we’d need FX conversion.
    const bySymbol: Record<string, number> = {};
    for (const b of wallet) {
      const bal = Number(b.balance);
      if (!Number.isFinite(bal)) continue;
      bySymbol[b.asset_symbol] = (bySymbol[b.asset_symbol] || 0) + bal;
    }
    const usdc = bySymbol['USDC'] ?? 0;
    const usd = bySymbol['USD'] ?? 0;
    const inr = bySymbol['INR'] ?? 0;
    return { bySymbol, display: usdc || usd || inr, displaySym: usdc ? 'USDC' : usd ? 'USD' : inr ? 'INR' : '—' };
  }, [wallet]);

  const handleStartStop = async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;

    try {
      if (bot.isRunning) {
        await bot.engine.stop();
      } else {
        const sym = (bot.config.symbol || '').trim().toUpperCase();
        const ex = ((bot.config as any).exchange || 'delta_india') as any;
        const conflict = bots.find(
          (b) =>
            b.isRunning &&
            b.id !== botId &&
            ((b.config as any).exchange || 'delta_india') === ex &&
            (b.config.symbol || '').trim().toUpperCase() === sym
        );
        if (conflict) {
          alertSystem.createAlert(
            'system',
            `A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'} (${conflict.name}). Stop it first.`,
            'high',
            sym
          );
          return;
        }
        if (((bot.config as any).execution || 'paper') === 'live') {
          const ok = confirm(
            `LIVE TRADING CONFIRMATION\n\nStarting this bot can place REAL orders on ${
              ex === 'delta_global' ? 'Delta Global' : 'Delta India'
            } for ${sym}.\n\nProceed?`
          );
          if (!ok) return;
        }
        // Capture "initial equity" snapshot for PnL metrics (best-effort).
        try {
          const ex = ((bot.config as any).exchange || 'delta_india') as any;
          const snap = await fetchEquitySnapshot(ex);
          updateBot(bot.id, { runtime: { startedAt: Date.now(), startedEquity: snap.value, startedCurrency: snap.label } });
        } catch {
          // ignore
        }
        await bot.engine.start();
      }

      // Update stats
      const updatedStats = bot.engine.getStats();
      const updatedBot = { ...bot, stats: updatedStats, isRunning: !bot.isRunning };

      const saved = await updateBot(bot.id, { isRunning: updatedBot.isRunning });
      if (!saved && updatedBot.isRunning) {
        alertSystem.createAlert('system', `A bot for ${updatedBot.config.symbol} is already running. Stop it first.`, 'high', updatedBot.config.symbol);
        // revert engine start if store rejected
        try { await bot.engine.stop(); } catch {}
        return;
      }

      setBots(prev => prev.map(b => b.id === botId ? updatedBot : b));
      if (selectedBot?.id === botId) {
        setSelectedBot(updatedBot);
      }
    } catch (error) {
      console.error('Error toggling bot:', error);
      alertSystem.createAlert('system', 'Failed to toggle bot', 'high');
    }
  };

  const handleDeleteBot = (botId: string) => {
    const b = bots.find((x) => x.id === botId);
    if (!b) return;
    if (b.isRunning) {
      // stop stream + engine
      void b.engine.stop();
    }
    void deleteBot(botId).catch(() => null);
    enginesRef.current.delete(botId);
    const es = streamsRef.current.get(botId);
    es?.close();
    streamsRef.current.delete(botId);
    setBots((prev) => prev.filter((x) => x.id !== botId));
    setSelectedBot((prev) => (prev?.id === botId ? null : prev));
  };

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((b) => {
      const s = `${b.config.symbol} ${b.config.mode}`.toLowerCase();
      return s.includes(q);
    });
  }, [bots, query]);

  const equity = useMemo(() => {
    // demo equity curve; replace with real time-series later
    const seed = [10000, 10040, 10015, 10090, 10110, 10070, 10160, 10120, 10190, 10245, 10210, 10260];
    return seed;
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Trading · Bots</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dashboard</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Live:</span>
            <span className="font-semibold text-slate-900">{selectedBot?.config.symbol || '—'}</span>
            <span className="text-slate-400">·</span>
            <span className="font-semibold text-slate-900">
              {selectedBot?.config.symbol && livePrices[selectedBot.config.symbol] !== undefined
                ? `$${formatPrice(livePrices[selectedBot.config.symbol])}`
                : '—'}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">BTCUSD</span>
            <span className="font-semibold text-slate-900">
              {headerTickers.BTCUSD?.price === undefined ? '—' : `$${formatPrice(headerTickers.BTCUSD.price)}`}
            </span>
            <Badge tone={typeof headerTickers.BTCUSD?.changePct === 'number' ? (headerTickers.BTCUSD.changePct >= 0 ? 'green' : 'red') : 'slate'}>
              {typeof headerTickers.BTCUSD?.changePct === 'number'
                ? `${headerTickers.BTCUSD.changePct >= 0 ? '+' : ''}${headerTickers.BTCUSD.changePct.toFixed(2)}%`
                : '—'}
            </Badge>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">ETHUSD</span>
            <span className="font-semibold text-slate-900">
              {headerTickers.ETHUSD?.price === undefined ? '—' : `$${formatPrice(headerTickers.ETHUSD.price)}`}
            </span>
            <Badge tone={typeof headerTickers.ETHUSD?.changePct === 'number' ? (headerTickers.ETHUSD.changePct >= 0 ? 'green' : 'red') : 'slate'}>
              {typeof headerTickers.ETHUSD?.changePct === 'number'
                ? `${headerTickers.ETHUSD.changePct >= 0 ? '+' : ''}${headerTickers.ETHUSD.changePct.toFixed(2)}%`
                : '—'}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bots…"
              className="w-full rounded-lg border border-slate-200 bg-white px-9 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 sm:w-64"
            />
          </div>

          <Button variant="secondary">
            <Bell className="h-4 w-4" />
            Alerts
            <Badge tone={alerts.some((a) => !a.isRead) ? 'yellow' : 'slate'}>{alerts.length}</Badge>
          </Button>
          <Link href="/bot/create">
            <Button>
              <Plus className="h-4 w-4" />
              New bot
            </Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Wallet balance</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {totalEquity.displaySym === '—'
                ? '—'
                : `${totalEquity.display.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${totalEquity.displaySym}`}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {walletError ? `Not connected: ${walletError}` : 'Live via Delta wallet'}
              </span>
              <Sparkline data={equity} width={120} height={34} stroke="#0f172a" fill="rgba(15,23,42,0.06)" />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Running bots</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {bots.filter((b) => b.isRunning).length}
            </div>
            <div className="mt-2 text-xs text-slate-500">Across all symbols</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Open positions</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {bots.reduce((sum, b) => sum + b.stats.activePositions, 0)}
            </div>
            <div className="mt-2 text-xs text-slate-500">Max positions respected</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500">Risk status</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone="green">Healthy</Badge>
              <span className="text-sm font-semibold text-slate-900">No breakers triggered</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Consecutive loss guard enabled</div>
          </CardBody>
        </Card>
      </div>

      {/* Top movers */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Top 5 Gainers (24h)" subtitle="Delta Exchange India (via configured base URL)" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-right font-medium">Last</th>
                    <th className="px-5 py-3 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topMovers?.gainers?.length ? (
                    topMovers.gainers.map((r) => (
                      <tr key={r.symbol} className="hover:bg-slate-50/60">
                        <td className="px-5 py-4 font-semibold text-slate-900">{r.symbol}</td>
                        <td className="px-5 py-4 text-right text-slate-900">
                          {Number.isFinite(r.last) ? r.last.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-emerald-700">
                          {Number.isFinite(r.changePct) ? `+${r.changePct.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-8 text-center text-sm text-slate-500" colSpan={3}>
                        {topMoversError ? `Error: ${topMoversError}` : 'Loading…'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top 5 Losers (24h)" subtitle="Delta Exchange India (via configured base URL)" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-right font-medium">Last</th>
                    <th className="px-5 py-3 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topMovers?.losers?.length ? (
                    topMovers.losers.map((r) => (
                      <tr key={r.symbol} className="hover:bg-slate-50/60">
                        <td className="px-5 py-4 font-semibold text-slate-900">{r.symbol}</td>
                        <td className="px-5 py-4 text-right text-slate-900">
                          {Number.isFinite(r.last) ? r.last.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-rose-700">
                          {Number.isFinite(r.changePct) ? `${r.changePct.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-8 text-center text-sm text-slate-500" colSpan={3}>
                        {topMoversError ? `Error: ${topMoversError}` : 'Loading…'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Bots table */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Bots"
            subtitle="Manage running bots, view status and key settings"
            right={
              <Button variant="secondary" size="sm">
                <Settings className="h-4 w-4" />
                Preferences
              </Button>
            }
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Bot</th>
                    <th className="px-5 py-3 text-left font-medium">Mode</th>
                    <th className="px-5 py-3 text-left font-medium">Range</th>
                    <th className="px-5 py-3 text-left font-medium">Grids</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBots.map((bot) => {
                    const isSelected = selectedBot?.id === bot.id;
                    return (
                      <tr
                        key={bot.id}
                        className={`cursor-pointer ${isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                        onClick={() => {
                          setSelectedBot(bot);
                        }}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                              <Zap className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900">{bot.config.symbol}</div>
                              <div className="text-xs text-slate-500">
                                Qty {bot.config.quantity} · Lev {bot.config.leverage}x
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 capitalize text-slate-700">{bot.config.mode}</td>
                        <td className="px-5 py-4 text-slate-700">
                          ${bot.config.lowerRange.toLocaleString()} → ${bot.config.upperRange.toLocaleString()}
                        </td>
                        <td className="px-5 py-4 text-slate-700">{bot.config.numberOfGrids}</td>
                        <td className="px-5 py-4">
                          {bot.isRunning ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Button
                            size="sm"
                            variant={bot.isRunning ? 'danger' : 'primary'}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartStop(bot.id);
                            }}
                          >
                            {bot.isRunning ? 'Stop' : 'Start'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredBots.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-sm text-slate-500" colSpan={6}>
                        No bots match your search.
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

