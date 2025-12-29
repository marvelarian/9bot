'use client';

import { useEffect, useRef } from 'react';
import type { GridBotConfig } from '@/lib/types';
import { refreshBots, updateBot, type BotRecord } from '@/lib/bot-store';
import { GridBotEngine } from '@/lib/grid-bot-engine';
import type { BotRuntimeOrder, BotRuntimePosition } from '@/lib/bots/types';

type EngineEntry = {
  engine: GridBotEngine;
  configHash: string;
  stream?: EventSource;
  lastPrice?: number;
  orders: BotRuntimeOrder[];
};

function safeHashConfig(cfg: GridBotConfig) {
  // Good enough for change detection; keeps the runner lightweight.
  try {
    return JSON.stringify(cfg);
  } catch {
    return String(Date.now());
  }
}

function toUpper(s: any) {
  return String(s || '').trim().toUpperCase();
}

export function BotRuntimeRunner() {
  const enginesRef = useRef<Map<string, EngineEntry>>(new Map());
  const lastRuntimeWriteRef = useRef<Map<string, number>>(new Map());
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let stopped = false;

    const ensure = (rec: BotRecord) => {
      const id = rec.id;
      const cfg = rec.config;
      const nextHash = safeHashConfig(cfg);
      let entry = enginesRef.current.get(id);

      if (!entry) {
        const orders: BotRuntimeOrder[] = Array.isArray(rec.runtime?.orders) ? (rec.runtime!.orders as any) : [];
        const exchange = {
          async getTicker(symbol: string) {
            // Engine's internal polling uses this; we also drive it from SSE, so this is a fallback.
            return { markPrice: entry?.lastPrice };
          },
          async placeOrder(req: any) {
            const ex = (cfg as any).exchange || 'delta_india';
            const exec = (cfg as any).execution || 'paper';
            if (exec !== 'live') {
              const id = `mock-${Date.now()}`;
              try {
                orders.unshift({
                  id,
                  exchange: ex,
                  execution: 'paper',
                  symbol: req.symbol || cfg.symbol,
                  side: req.side,
                  order_type: req.order_type || 'market',
                  size: req.size,
                  price: req.price,
                  triggerLevelPrice: req.triggerLevelPrice,
                  triggerDirection: req.triggerDirection,
                  prevPrice: req.prevPrice,
                  currentPrice: req.currentPrice,
                  createdAtMs: Date.now(),
                  status: 'filled',
                });
                orders.splice(120);
              } catch {}
              // Telegram: paper order placed (best-effort)
              try {
                const sym = String(req.symbol || cfg.symbol || '').toUpperCase();
                const px = typeof req.price === 'number' && Number.isFinite(req.price) ? req.price : null;
                fetch('/api/alerts/telegram', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    text: [
                      `<b>9BOT</b> — Paper order (simulated) ✅`,
                      `<b>Exchange:</b> ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}`,
                      sym ? `<b>Symbol:</b> ${sym}` : null,
                      `<b>Side:</b> ${String(req.side || '').toUpperCase()}`,
                      `<b>Type:</b> ${String(req.order_type || 'market').toUpperCase()}`,
                      `<b>Size:</b> ${Number(req.size)}`,
                      px === null ? null : `<b>Price:</b> ${px.toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
                      `<b>Order ID:</b> ${id}`,
                      `<b>Time:</b> ${new Date().toISOString()}`,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  }),
                }).catch(() => null);
              } catch {}
              return { id };
            }

            const payload = {
              exchange: ex,
              symbol: req.symbol || cfg.symbol,
              side: req.side,
              order_type: req.order_type || 'market',
              size: req.size,
              price: req.price,
              // debug context (ignored by server route if unknown)
              triggerLevelPrice: req.triggerLevelPrice,
              triggerDirection: req.triggerDirection,
              prevPrice: req.prevPrice,
              currentPrice: req.currentPrice,
            };

            const res = await fetch('/api/delta/order', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => null);
            if (!json?.ok) {
              // Persist a rejected attempt so UI can show why "nothing happened".
              const rid = `rejected-${Date.now()}`;
              try {
                orders.unshift({
                  id: rid,
                  exchange: ex,
                  execution: 'live',
                  symbol: payload.symbol,
                  side: payload.side,
                  order_type: payload.order_type,
                  size: Number(payload.size),
                  price: payload.price,
                  triggerLevelPrice: payload.triggerLevelPrice,
                  triggerDirection: payload.triggerDirection,
                  prevPrice: payload.prevPrice,
                  currentPrice: payload.currentPrice,
                  createdAtMs: Date.now(),
                  status: 'rejected',
                  error: String(json?.error || 'place order failed'),
                });
                orders.splice(120);
              } catch {}
              throw new Error(json?.error || 'place order failed');
            }
            try {
              orders.unshift({
                id: String(json.id || json?.result?.id || `delta-${Date.now()}`),
                exchange: ex,
                execution: 'live',
                symbol: req.symbol || cfg.symbol,
                side: req.side,
                order_type: req.order_type || 'market',
                size: req.size,
                price: req.price,
                  triggerLevelPrice: req.triggerLevelPrice,
                  triggerDirection: req.triggerDirection,
                  prevPrice: req.prevPrice,
                  currentPrice: req.currentPrice,
                createdAtMs: Date.now(),
                status: 'submitted',
              });
              orders.splice(120);
            } catch {}
            return { id: json.id || json?.result?.id || `delta-${Date.now()}` };
          },
          async cancelOrder(orderId: string) {
            const ex = (cfg as any).exchange || 'delta_india';
            const exec = (cfg as any).execution || 'paper';
            if (exec !== 'live') return;
            await fetch(`/api/delta/order?orderId=${encodeURIComponent(orderId)}&exchange=${encodeURIComponent(ex)}`, {
              method: 'DELETE',
              cache: 'no-store',
            }).catch(() => null);
          },
          async getWalletBalances() {
            const ex = (cfg as any).exchange || 'delta_india';
            const res = await fetch(`/api/delta/wallet?exchange=${encodeURIComponent(ex)}`, { cache: 'no-store' });
            const json = await res.json();
            if (!json?.ok) return [];
            return Array.isArray(json.result) ? json.result : [];
          },
        };

        const engine = new GridBotEngine(cfg, exchange as any);
        // Rehydrate from last persisted runtime so exits/anti-oscillation survive HMR/reloads.
        try {
          engine.hydrateRuntime({
            lastPrice: rec.runtime?.lastPrice,
            positions: Array.isArray(rec.runtime?.positions) ? (rec.runtime!.positions as any) : undefined,
            levels: Array.isArray(rec.runtime?.levels) ? (rec.runtime!.levels as any) : undefined,
            paperStats: (rec.runtime as any)?.paperStats,
          });
        } catch {}
        entry = { engine, configHash: nextHash, orders };
        enginesRef.current.set(id, entry);
      } else if (entry.configHash !== nextHash) {
        entry.engine.updateConfig(cfg);
        entry.configHash = nextHash;
      }

      return entry;
    };

    const stopEntry = async (id: string, entry: EngineEntry) => {
      try {
        entry.stream?.close();
      } catch {}
      entry.stream = undefined;
      try {
        await entry.engine.stop();
      } catch {}
    };

    const tick = async () => {
      if (stopped) return;

      let records: BotRecord[] = [];
      try {
        records = await refreshBots();
      } catch {
        records = [];
      }
      const keepIds = new Set(records.map((b) => b.id));

      // Stop engines for deleted bots
      const stale: Array<[string, EngineEntry]> = [];
      enginesRef.current.forEach((entry, id) => {
        if (!keepIds.has(id)) stale.push([id, entry]);
      });
      for (const [id, entry] of stale) {
        await stopEntry(id, entry);
        enginesRef.current.delete(id);
      }

      // Start/stop per current store
      for (const rec of records) {
        const entry = ensure(rec);
        if (!entry) continue;

        if (!rec.isRunning) {
          if (entry.stream) await stopEntry(rec.id, entry);
          continue;
        }

        // Start engine + SSE stream when running
        if (!entry.stream) {
          try {
            await entry.engine.start();
          } catch {}

          const ex = ((rec.config as any).exchange || 'delta_india') as any;
          const sym = toUpper(rec.config.symbol);
          if (!sym) continue;

          const es = new EventSource(
            `/api/prices/stream?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(ex)}&intervalMs=1000`
          );
          entry.stream = es;

          es.onmessage = (evt) => {
            try {
              const data = JSON.parse(evt.data);
              if (typeof data?.markPrice !== 'number') return;
              const p = data.markPrice as number;
              entry.lastPrice = p;

              // Drive engine
              void entry.engine.processPriceUpdate(p).catch(() => null);

              // Persist runtime snapshot so Grid Status / Home show actual activity
              const last = lastRuntimeWriteRef.current.get(rec.id) || 0;
              const now = Date.now();
              if (now - last > 900) {
                lastRuntimeWriteRef.current.set(rec.id, now);
                const levels = entry.engine.getGridLevels();
                const exec = (((rec.config as any).execution || 'paper') as 'paper' | 'live');
                const needsStartedPrice = rec.isRunning && (rec.runtime?.startedPrice === undefined || rec.runtime?.startedPrice === null);
                const needsPaperStartedPrice =
                  exec === 'paper' && rec.isRunning && (rec.runtime?.paperStartedPrice === undefined || rec.runtime?.paperStartedPrice === null);
                const baselinePatch = needsStartedPrice || needsPaperStartedPrice ? { startedPrice: p, ...(needsPaperStartedPrice ? { paperStartedPrice: p } : {}) } : null;

                const positions: BotRuntimePosition[] = entry.engine.getPositions().map((pos: any) => ({
                  symbol: String(pos.symbol || rec.config.symbol || ''),
                  side: pos.side,
                  quantity: Number(pos.quantity),
                  entryPrice: Number(pos.entryPrice),
                  orderId: String(pos.orderId || ''),
                  leverage: Number(pos.leverage || (rec.config as any).leverage || 1),
                  timestampMs: pos.timestamp instanceof Date ? pos.timestamp.getTime() : Date.now(),
                }));
                const paperStatsRaw = entry.engine.getPaperTradeStats();
                const paperStats = { ...paperStatsRaw, winRate: paperStatsRaw.winRate ?? undefined };
                void updateBot(rec.id, {
                  runtime: {
                    lastPrice: p,
                    updatedAt: now,
                    ...(baselinePatch || {}),
                    positions: positions.slice(-50),
                    orders: (entry.orders || []).slice(0, 120),
                    paperStats,
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
            } catch {
              // ignore
            }
          };
        }
      }
    };

    const handler = () => void tick();
    window.addEventListener('bots:changed', handler);

    // Initial kick + periodic reconciliation (covers missed events / multi-tab edge cases)
    void tick();
    const interval = setInterval(() => void tick(), 5000);

    // Telegram scheduled summaries (server-side throttled): run a lightweight trigger loop.
    summaryTimerRef.current = setInterval(() => {
      fetch('/api/alerts/telegram/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: false }),
      }).catch(() => null);
    }, 30_000);

    return () => {
      stopped = true;
      window.removeEventListener('bots:changed', handler);
      clearInterval(interval);
      if (summaryTimerRef.current) clearInterval(summaryTimerRef.current);
      summaryTimerRef.current = null;
      // Best-effort cleanup
      enginesRef.current.forEach((entry) => {
        try {
          entry.stream?.close();
        } catch {}
        entry.stream = undefined;
        try {
          void entry.engine.stop();
        } catch {}
      });
      enginesRef.current.clear();
    };
  }, []);

  return null;
}



