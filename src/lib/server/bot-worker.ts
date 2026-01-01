import { GridBotEngine } from '@/lib/grid-bot-engine';
import type { BotRecord, BotRuntimeOrder, BotRuntimePosition } from '@/lib/bots/types';
import { listBots, patchBotForUser } from '@/lib/server/bots-store';
import { readDeltaCredentials } from '@/lib/delta-credentials-store';
import { DEFAULT_DELTA_BASE_URL, DELTA_INDIA_BASE_URL, deltaFetch, getDeltaAuth } from '@/lib/delta-signing';
import { getDeltaProductId } from '@/lib/delta-products';
import { sendTelegramText } from '@/lib/telegram-send';

type EngineEntry = {
  engine: GridBotEngine;
  configHash: string;
  orders: BotRuntimeOrder[];
  lastPersistAt: number;
};

function safeHashConfig(cfg: unknown) {
  try {
    return JSON.stringify(cfg);
  } catch {
    return String(Date.now());
  }
}

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function fetchDeltaMarkPrice(baseUrl: string, symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/v2/tickers/${encodeURIComponent(symbol)}`, {
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const t = json?.result ?? {};
    return (
      toNum(t.mark_price) ??
      toNum(t.markPrice) ??
      toNum(t.last_price) ??
      toNum(t.lastPrice) ??
      toNum(t.close) ??
      null
    );
  } catch {
    return null;
  }
}

async function persistRuntime(ownerEmail: string, bot: BotRecord, entry: EngineEntry, lastPrice: number | null) {
  const now = Date.now();

  const cfg: any = bot.config || {};
  const exec = (((cfg as any).execution || 'paper') as 'paper' | 'live');
  const startedPriceMissing = bot.isRunning && (bot.runtime?.startedPrice === undefined || bot.runtime?.startedPrice === null);
  const paperStartedMissing =
    exec === 'paper' && bot.isRunning && (bot.runtime?.paperStartedPrice === undefined || bot.runtime?.paperStartedPrice === null);

  const baselinePatch =
    lastPrice !== null && (startedPriceMissing || paperStartedMissing)
      ? { startedPrice: lastPrice, ...(paperStartedMissing ? { paperStartedPrice: lastPrice } : {}) }
      : null;

  const levels = entry.engine.getGridLevels();
  const positions: BotRuntimePosition[] = entry.engine.getPositions().map((pos: any) => ({
    symbol: String(pos.symbol || cfg.symbol || ''),
    side: pos.side,
    quantity: Number(pos.quantity),
    entryPrice: Number(pos.entryPrice),
    orderId: String(pos.orderId || ''),
    leverage: Number(pos.leverage || cfg.leverage || 1),
    timestampMs: pos.timestamp instanceof Date ? pos.timestamp.getTime() : Date.now(),
  }));

  const paperStatsRaw = entry.engine.getPaperTradeStats();
  const paperStats = { ...paperStatsRaw, winRate: paperStatsRaw.winRate ?? undefined };

  await patchBotForUser(ownerEmail, bot.id, {
    runtime: {
      ...(bot.runtime || {}),
      updatedAt: now,
      ...(lastPrice !== null ? { lastPrice } : {}),
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

export function startBotWorker() {
  // EC2-only: enable explicitly.
  if (process.env.BOT_WORKER_ENABLED !== 'true') return;

  const g = globalThis as any;
  if (g.__botWorkerStarted) return;
  g.__botWorkerStarted = true;

  const ownerEmail = String(process.env.BOT_WORKER_OWNER_EMAIL || '').trim();
  if (!ownerEmail) {
    console.warn('[9bot-worker] BOT_WORKER_OWNER_EMAIL is missing; worker will not start.');
    return;
  }

  const engines = new Map<string, EngineEntry>();

  const ensureEngine = async (bot: BotRecord) => {
    const cfg: any = bot.config || {};
    const ex = ((cfg as any).exchange || 'delta_india') as 'delta_india' | 'delta_global';
    const exec = (((cfg as any).execution || 'paper') as 'paper' | 'live');
    const symbol = String(cfg.symbol || '').trim().toUpperCase();
    if (!symbol) return null;

    const stored = await readDeltaCredentials(ex);
    const baseUrl =
      stored?.baseUrl ||
      process.env.DELTA_BASE_URL ||
      (ex === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);

    const nextHash = safeHashConfig(cfg);
    let entry = engines.get(bot.id);

    if (!entry) {
      const orders: BotRuntimeOrder[] = Array.isArray(bot.runtime?.orders) ? (bot.runtime!.orders as any) : [];

      const adapter = {
        async getTicker(sym: string) {
          const p = await fetchDeltaMarkPrice(baseUrl, sym);
          return { markPrice: p ?? undefined };
        },
        async placeOrder(req: any) {
          const side = req.side;
          const order_type = req.order_type || 'market';
          const size = Number(req.size);
          const price = req.price;

          if (exec !== 'live') {
            const id = `mock-${Date.now()}`;
            try {
              orders.unshift({
                id,
                exchange: ex,
                execution: 'paper',
                symbol: req.symbol || symbol,
                side,
                order_type,
                size,
                price,
                triggerLevelPrice: req.triggerLevelPrice,
                triggerDirection: req.triggerDirection,
                prevPrice: req.prevPrice,
                currentPrice: req.currentPrice,
                createdAtMs: Date.now(),
                status: 'filled',
              });
              orders.splice(120);
            } catch {}

            // Telegram (server-side): paper order placed
            try {
              await sendTelegramText(
                [
                  `<b>9BOT</b> — Paper order (simulated) ✅`,
                  `<b>Exchange:</b> ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}`,
                  `<b>Symbol:</b> ${(req.symbol || symbol).toUpperCase()}`,
                  `<b>Side:</b> ${String(side || '').toUpperCase()}`,
                  `<b>Type:</b> ${String(order_type || 'market').toUpperCase()}`,
                  `<b>Size:</b> ${Number(size)}`,
                  `<b>Order ID:</b> ${id}`,
                  `<b>Time:</b> ${new Date().toISOString()}`,
                ].join('\n')
              );
            } catch {}

            return { id };
          }

          // LIVE: place via Delta API (no browser session required).
          const { auth } = await getDeltaAuth({ exchange: ex });
          const product_id =
            typeof req.product_id === 'number' && Number.isFinite(req.product_id)
              ? req.product_id
              : await getDeltaProductId({ baseUrl, symbol: req.symbol || symbol });

          const payload: any = {
            product_id,
            side,
            order_type: order_type === 'limit' ? 'limit_order' : 'market_order',
            size: Number(size),
          };
          if (order_type === 'limit' && typeof price === 'number' && Number.isFinite(price)) payload.price = price;

          try {
            const res = await deltaFetch<any>({
              method: 'POST',
              path: '/v2/orders',
              auth,
              baseUrl,
              body: payload,
            });
            const order = res?.result ?? res;
            const id = String(order?.id || order?.order_id || order?.uuid || `delta-${Date.now()}`);

            try {
              orders.unshift({
                id,
                exchange: ex,
                execution: 'live',
                symbol: req.symbol || symbol,
                side,
                order_type,
                size: Number(size),
                price,
                triggerLevelPrice: req.triggerLevelPrice,
                triggerDirection: req.triggerDirection,
                prevPrice: req.prevPrice,
                currentPrice: req.currentPrice,
                createdAtMs: Date.now(),
                status: 'submitted',
              });
              orders.splice(120);
            } catch {}

            // Telegram (server-side): live order placed
            try {
              await sendTelegramText(
                [
                  `<b>9BOT</b> — Order placed ✅`,
                  `<b>Exchange:</b> ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}`,
                  `<b>Symbol:</b> ${(req.symbol || symbol).toUpperCase()}`,
                  `<b>Side:</b> ${String(side || '').toUpperCase()}`,
                  `<b>Type:</b> ${String(order_type || 'market').toUpperCase()}`,
                  `<b>Size:</b> ${Number(size)}`,
                  `<b>Order ID:</b> ${id}`,
                  `<b>Time:</b> ${new Date().toISOString()}`,
                ].join('\n')
              );
            } catch {}

            return { id };
          } catch (e: any) {
            const rid = `rejected-${Date.now()}`;
            try {
              orders.unshift({
                id: rid,
                exchange: ex,
                execution: 'live',
                symbol: req.symbol || symbol,
                side,
                order_type,
                size: Number(size),
                price,
                triggerLevelPrice: req.triggerLevelPrice,
                triggerDirection: req.triggerDirection,
                prevPrice: req.prevPrice,
                currentPrice: req.currentPrice,
                createdAtMs: Date.now(),
                status: 'rejected',
                error: String(e?.message || 'place order failed'),
              });
              orders.splice(120);
            } catch {}
            throw e;
          }
        },
        async cancelOrder(orderId: string) {
          if (exec !== 'live') return;
          try {
            const { auth } = await getDeltaAuth({ exchange: ex });
            await deltaFetch<any>({
              method: 'DELETE',
              path: `/v2/orders/${encodeURIComponent(orderId)}`,
              auth,
              baseUrl,
            });
          } catch {
            // best-effort
          }
        },
        async getWalletBalances() {
          return [];
        },
      };

      const engine = new GridBotEngine(cfg, adapter as any);
      try {
        engine.hydrateRuntime({
          lastPrice: bot.runtime?.lastPrice,
          positions: Array.isArray(bot.runtime?.positions) ? (bot.runtime!.positions as any) : undefined,
          levels: Array.isArray(bot.runtime?.levels) ? (bot.runtime!.levels as any) : undefined,
          paperStats: (bot.runtime as any)?.paperStats,
        });
      } catch {}

      try {
        await engine.start();
      } catch {}

      entry = { engine, configHash: nextHash, orders, lastPersistAt: 0 };
      engines.set(bot.id, entry);
      return { entry, baseUrl, symbol };
    }

    if (entry.configHash !== nextHash) {
      entry.engine.updateConfig(cfg);
      entry.configHash = nextHash;
    }

    return { entry, baseUrl, symbol };
  };

  const loop = async () => {
    const bots = await listBots(ownerEmail).catch(() => []);
    const running = bots.filter((b) => b.isRunning);

    // Stop engines for bots no longer running
    engines.forEach((entry, id) => {
      if (!running.some((b) => b.id === id)) {
        try {
          void entry.engine.stop();
        } catch {}
        engines.delete(id);
      }
    });

    for (const bot of running) {
      const ensured = await ensureEngine(bot);
      if (!ensured) continue;

      const { entry, baseUrl, symbol } = ensured;
      const now = Date.now();
      if (now - entry.lastPersistAt < 900) continue;
      entry.lastPersistAt = now;

      const lastPrice = await fetchDeltaMarkPrice(baseUrl, symbol);
      await persistRuntime(ownerEmail, bot, entry, lastPrice);
    }
  };

  // Run in fork mode only (single process) to avoid duplicate orders.
  setInterval(() => void loop(), 1200);
  void loop();
}


