import { GridBotEngine } from '@/lib/grid-bot-engine';
import type { BotRecord, BotRuntimeOrder, BotRuntimePosition } from '@/lib/bots/types';
import { listBots, patchBotForUser } from '@/lib/server/bots-store';
import { readDeltaCredentials } from '@/lib/delta-credentials-store';
import { DEFAULT_DELTA_BASE_URL, DELTA_INDIA_BASE_URL, deltaFetch, getDeltaAuth } from '@/lib/delta-signing';
import { getDeltaProductMeta } from '@/lib/delta-products';
import { normalizeDeltaOrderSize } from '@/lib/delta-order-sizing';
import { sendTelegramText } from '@/lib/telegram-send';
import { appendEquityPoint } from '@/lib/server/equity-history';
import { getTelegramSummaryConfig, markTelegramSummarySent } from '@/lib/server/telegram-summary-store';

type EngineEntry = {
  engine: GridBotEngine;
  configHash: string;
  orders: BotRuntimeOrder[];
  lastPersistAt: number;
  lastLiveStatsAt?: number;
  // Leverage is an account/product setting on Delta; apply best-effort before placing orders.
  lastOrderLeverageApplied?: number;
  lastOrderLeverageAppliedAt?: number;
};

function fmtPct(p: number): string {
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

function toNumOrNull(v: any): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function notionalMultiplierFromBot(bot: BotRecord): number | null {
  const cfg: any = bot.config || {};
  const rt: any = bot.runtime || {};
  const lots = toNumOrNull(cfg?.quantity);
  if (lots === null || lots <= 0) return null;
  const lotSize = toNumOrNull(rt?.lotSize ?? cfg?.lotSize) ?? 1;
  const cv = toNumOrNull(rt?.contractValue ?? cfg?.contractValue) ?? 1;
  const contracts = Math.floor(lots) * Math.floor(lotSize > 0 ? lotSize : 1);
  const mult = contracts * (cv > 0 ? cv : 1);
  return Number.isFinite(mult) && mult > 0 ? mult : null;
}

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

function toUpper(s: any) {
  return String(s || '').trim().toUpperCase();
}

function pickSide(raw: any): 'buy' | 'sell' | null {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'buy' || s === 'long') return 'buy';
  if (s === 'sell' || s === 'short') return 'sell';
  return null;
}

function pickRealizedPnl(f: any): number | null {
  return (
    toNum(f?.realized_pnl) ??
    toNum(f?.realizedPnl) ??
    toNum(f?.pnl) ??
    toNum(f?.profit) ??
    toNum(f?.trade_pnl) ??
    toNum(f?.realized_pnl_inr) ??
    toNum(f?.realized_pnl_usd) ??
    toNum(f?.realized_pnl_usdc) ??
    null
  );
}

async function computeLiveRealizedPnl(params: {
  exchange: 'delta_india' | 'delta_global';
  baseUrl: string;
  symbol: string;
  sinceMs: number | null;
}): Promise<{ realizedPnl: number; winTrades: number; lossTrades: number; winRate?: number; sinceMs?: number }> {
  const { auth } = await getDeltaAuth({ exchange: params.exchange });
  const qs = new URLSearchParams();
  qs.set('symbol', toUpper(params.symbol));
  qs.set('limit', '200');
  if (typeof params.sinceMs === 'number' && Number.isFinite(params.sinceMs)) {
    // Delta expects seconds (typical) but can vary; use seconds to match common API conventions.
    qs.set('start_time', String(Math.floor(params.sinceMs / 1000)));
  }
  const path = `/v2/fills?${qs.toString()}`;
  const res = await deltaFetch<any>({ method: 'GET', path, auth, baseUrl: params.baseUrl });
  const list = Array.isArray(res?.result) ? res.result : Array.isArray(res) ? res : [];

  let realized = 0;
  let win = 0;
  let loss = 0;
  for (const f of list as any[]) {
    const sym = toUpper(f?.product_symbol || f?.symbol || f?.product?.symbol);
    if (sym && sym !== toUpper(params.symbol)) continue;
    const rp = pickRealizedPnl(f);
    if (rp === null) continue;
    realized += rp;
    if (rp > 0) win += 1;
    else if (rp < 0) loss += 1;
  }
  const denom = win + loss;
  const winRate = denom > 0 ? win / denom : undefined;
  return { realizedPnl: realized, winTrades: win, lossTrades: loss, winRate, sinceMs: params.sinceMs ?? undefined };
}

async function fetchEquitySnapshotServer(params: { exchange: 'delta_india' | 'delta_global'; baseUrl: string }) {
  const { auth } = await getDeltaAuth({ exchange: params.exchange });
  const [wRes, pRes] = await Promise.all([
    deltaFetch<any>({ method: 'GET', path: '/v2/wallet/balances', auth, baseUrl: params.baseUrl }),
    deltaFetch<any>({ method: 'GET', path: '/v2/positions/margined', auth, baseUrl: params.baseUrl }).catch(() => null),
  ]);

  const wallet = Array.isArray(wRes?.result) ? wRes.result : [];
  const positions = Array.isArray(pRes?.result) ? pRes.result : [];

  // Prefer INR if *_inr exists (Delta India often provides this).
  let inr = 0;
  let hasInr = false;
  for (const row of wallet as any[]) {
    const bi = toNum(row?.balance_inr);
    if (bi !== null) {
      inr += bi;
      hasInr = true;
    }
  }
  if (hasInr) {
    for (const p of positions as any[]) {
      const up = toNum(p?.unrealized_pnl_inr);
      if (up !== null) inr += up;
    }
    return { value: inr, label: 'INR' as const };
  }

  // Fallback: sum settlement currency balance.
  const by: Record<string, number> = {};
  for (const row of wallet as any[]) {
    const sym = String(row?.asset_symbol || '');
    const bal = toNum(row?.balance);
    if (!sym || bal === null) continue;
    by[sym] = (by[sym] || 0) + bal;
  }
  const label = by.USDC ? 'USDC' : by.USD ? 'USD' : by.INR ? 'INR' : '—';
  return { value: label === '—' ? 0 : by[label], label: label as any };
}

async function fetchOpenPositionsForSymbol(params: {
  exchange: 'delta_india' | 'delta_global';
  baseUrl: string;
  symbol: string;
}): Promise<Array<{ symbol: string; side: 'buy' | 'sell'; sizeAbs: number }>> {
  const { auth } = await getDeltaAuth({ exchange: params.exchange });
  const res = await deltaFetch<any>({
    method: 'GET',
    path: '/v2/positions/margined',
    auth,
    baseUrl: params.baseUrl,
  });
  const list = Array.isArray(res?.result) ? res.result : Array.isArray(res) ? res : [];
  const sym = toUpper(params.symbol);

  const out: Array<{ symbol: string; side: 'buy' | 'sell'; sizeAbs: number }> = [];
  for (const p of list as any[]) {
    const ps = toUpper(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? p?.productSymbol);
    if (!ps || ps !== sym) continue;

    const side = pickSide(p?.side ?? p?.position_side ?? p?.direction ?? p?.order_side);
    const sizeRaw =
      toNum(p?.size) ??
      toNum(p?.position_size) ??
      toNum(p?.quantity) ??
      toNum(p?.net_quantity) ??
      toNum(p?.net_size) ??
      toNum(p?.position_qty) ??
      0;

    const sizeNum = Number(sizeRaw);
    if (!Number.isFinite(sizeNum) || sizeNum === 0) continue;

    // Some APIs use sign for direction; if side is missing, infer from sign.
    const inferredSide = side ?? (sizeNum > 0 ? 'buy' : 'sell');
    out.push({ symbol: ps, side: inferredSide, sizeAbs: Math.abs(sizeNum) });
  }
  return out;
}

async function flattenSymbolAllPositions(params: {
  exchange: 'delta_india' | 'delta_global';
  baseUrl: string;
  symbol: string;
}): Promise<{ closed: number }> {
  const sym = toUpper(params.symbol);
  const open = await fetchOpenPositionsForSymbol(params);
  let closed = 0;
  if (!open.length) return { closed };

  const { auth } = await getDeltaAuth({ exchange: params.exchange });
  const productId = (await getDeltaProductMeta({ baseUrl: params.baseUrl, symbol: sym })).id;

  for (const p of open) {
    const closeSide = p.side === 'buy' ? 'sell' : 'buy';
    const size = Number(p.sizeAbs);
    if (!Number.isFinite(size) || size <= 0) continue;
    await deltaFetch<any>({
      method: 'POST',
      path: '/v2/orders',
      auth,
      baseUrl: params.baseUrl,
      body: {
        product_id: productId,
        side: closeSide,
        order_type: 'market_order',
        size,
      },
    });
    closed += 1;
  }

  return { closed };
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
  const stats = entry.engine.getStats();

  await patchBotForUser(ownerEmail, bot.id, {
    runtime: {
      ...(bot.runtime || {}),
      updatedAt: now,
      ...(lastPrice !== null ? { lastPrice } : {}),
      ...(baselinePatch || {}),
      consecutiveLosses: stats.consecutiveLosses,
      lotSize: Number.isFinite(Number(entry.engine.getConfig()?.lotSize))
        ? Number(entry.engine.getConfig().lotSize)
        : Number((cfg as any).lotSize) || undefined,
      contractValue: Number.isFinite(Number(entry.engine.getConfig()?.contractValue))
        ? Number(entry.engine.getConfig().contractValue)
        : Number((cfg as any).contractValue) || undefined,
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
  const lastKnownRunning = new Map<string, boolean>();
  const lastEquityAppendAt = new Map<'live' | 'paper', number>([
    ['live', 0],
    ['paper', 0],
  ]);
  let lastSummaryCheckAt = 0;

  const stopBotInStore = async (bot: BotRecord, reason: string) => {
    await patchBotForUser(ownerEmail, bot.id, {
      isRunning: false,
      runtime: { ...(bot.runtime || {}), riskStopReason: reason, riskStoppedAt: Date.now(), updatedAt: Date.now() },
    }).catch(() => null);
  };

  const stopAndFlatten = async (
    bot: BotRecord,
    ctx: { exchange: 'delta_india' | 'delta_global'; baseUrl: string; symbol: string },
    reason: string,
    lastPrice?: number | null
  ) => {
    const cfg: any = bot.config || {};
    const exec = (((cfg as any).execution || 'paper') as 'paper' | 'live');

    const entry = engines.get(bot.id);

    if (exec === 'live') {
      // LIVE: flatten ALL exchange positions for the bot symbol.
      try {
        await flattenSymbolAllPositions({ exchange: ctx.exchange, baseUrl: ctx.baseUrl, symbol: ctx.symbol });
      } catch {
        // best-effort
      }
      // Stop engine instance if present
      if (entry) {
        try {
          await entry.engine.stop();
        } catch {}
        engines.delete(bot.id);
      }
    } else {
      // PAPER: force-close internal positions at the latest known price so simulated PnL/loss streak update.
      if (entry && typeof lastPrice === 'number' && Number.isFinite(lastPrice)) {
        try {
          await entry.engine.forceCloseAllOpenPositions(lastPrice, reason.startsWith('max_consecutive_loss') ? 'max_consecutive_loss' : (reason as any));
        } catch {
          // best-effort
        }
        // Persist final snapshot (positions should be 0 after forced closes)
        try {
          await persistRuntime(ownerEmail, bot, entry, lastPrice);
        } catch {
          // ignore
        }
      }
      if (entry) {
        try {
          await entry.engine.stop(); // clears any remaining positions for paper mode
        } catch {}
        engines.delete(bot.id);
      }
    }

    await stopBotInStore(bot, reason);

    // Telegram best-effort
    try {
      await sendTelegramText(
        [
          `<b>9BOT</b> — Risk stop ⛔`,
          `<b>Reason:</b> ${reason}`,
          `<b>Symbol:</b> ${toUpper(ctx.symbol)}`,
          `<b>Exchange:</b> ${ctx.exchange === 'delta_global' ? 'Delta Global' : 'Delta India'}`,
          `<b>Time:</b> ${new Date().toISOString()}`,
        ].join('\n')
      );
    } catch {}
  };

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
          const sym = req.symbol || symbol;
          const product = await getDeltaProductMeta({ baseUrl, symbol: sym });
          const product_id = product.id;
          const normalized = normalizeDeltaOrderSize({ requestedSize: Number(size), product });
          const desiredLevRaw = Number((req as any)?.leverage ?? (cfg as any)?.leverage ?? 1);
          const desiredLev = Number.isFinite(desiredLevRaw) && desiredLevRaw > 0 ? desiredLevRaw : 1;

          // Best-effort: set order leverage for this product before placing orders.
          // Swagger: POST /v2/products/{product_id}/orders/leverage { leverage: "10" }
          if (entry) {
            const last = entry.lastOrderLeverageApplied;
            const shouldApply = last === undefined || last !== desiredLev;
            if (shouldApply) {
              try {
                await deltaFetch<any>({
                  method: 'POST',
                  path: `/v2/products/${product_id}/orders/leverage`,
                  auth,
                  baseUrl,
                  body: { leverage: String(desiredLev) },
                });
                entry.lastOrderLeverageApplied = desiredLev;
                entry.lastOrderLeverageAppliedAt = Date.now();
              } catch {
                // ignore: do not block order placement if leverage call fails
              }
            }
          }

          const payload: any = {
            product_id,
            side,
            order_type: order_type === 'limit' ? 'limit_order' : 'market_order',
            size: normalized.size,
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
                symbol: sym,
                side,
                order_type,
                size: normalized.size,
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
                  `<b>Symbol:</b> ${sym.toUpperCase()}`,
                  `<b>Side:</b> ${String(side || '').toUpperCase()}`,
                  `<b>Type:</b> ${String(order_type || 'market').toUpperCase()}`,
                  `<b>Size:</b> ${normalized.size}${normalized.adjusted ? ` (adj from ${Number(size)})` : ''}`,
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
                symbol: sym,
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

      // Derive lot sizing from Delta products (public endpoint; no auth required).
      // Qty in config is ALWAYS lots. Order size (contracts) = lots * lotSize.
      let lotSize = 1;
      let contractValue = 1;
      try {
        const meta = await getDeltaProductMeta({ baseUrl, symbol: cfg.symbol || symbol });
        const ms = Number(meta.minOrderSize ?? 1);
        const cv = Number(meta.contractValue ?? 1);
        lotSize = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 1;
        contractValue = Number.isFinite(cv) && cv > 0 ? cv : 1;
      } catch {
        // best-effort: keep defaults
      }

      const cfgWithMeta = { ...cfg, lotSize, contractValue };

      const engine = new GridBotEngine(cfgWithMeta, adapter as any);
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
      // Keep lot sizing meta in sync on config changes (symbol changes, etc.)
      let lotSize = 1;
      let contractValue = 1;
      try {
        const meta = await getDeltaProductMeta({ baseUrl, symbol: cfg.symbol || symbol });
        const ms = Number(meta.minOrderSize ?? 1);
        const cv = Number(meta.contractValue ?? 1);
        lotSize = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 1;
        contractValue = Number.isFinite(cv) && cv > 0 ? cv : 1;
      } catch {}
      entry.engine.updateConfig({ ...cfg, lotSize, contractValue });
      entry.configHash = nextHash;
    }

    return { entry, baseUrl, symbol };
  };

  const loop = async () => {
    const bots = await listBots(ownerEmail).catch(() => []);
    const byId = new Map(bots.map((b) => [b.id, b]));
    const running = bots.filter((b) => b.isRunning);

    // Periodic equity history append (24/7 on EC2)
    const nowAll = Date.now();
    const equityIntervalMs = Number(process.env.EQUITY_HISTORY_INTERVAL_MS || '30000');

    // LIVE equity: account-level snapshot (choose delta_india if configured else delta_global)
    if (nowAll - (lastEquityAppendAt.get('live') || 0) > equityIntervalMs) {
      try {
        const ex: 'delta_india' | 'delta_global' = (await readDeltaCredentials('delta_india'))
          ? 'delta_india'
          : (await readDeltaCredentials('delta_global'))
            ? 'delta_global'
            : 'delta_india';
        const stored = await readDeltaCredentials(ex);
        const baseUrl =
          stored?.baseUrl ||
          process.env.DELTA_BASE_URL ||
          (ex === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);
        const snap = await fetchEquitySnapshotServer({ exchange: ex, baseUrl });
        await appendEquityPoint(ownerEmail, { mode: 'live', label: snap.label, value: snap.value });
        lastEquityAppendAt.set('live', nowAll);
      } catch {
        // ignore
      }
    }

    // PAPER equity: sum of (initial capital + realized + unrealized) across paper bots (best-effort)
    if (nowAll - (lastEquityAppendAt.get('paper') || 0) > equityIntervalMs) {
      try {
        let totalEquity = 0;
        for (const b of bots) {
          const exec = (((b.config as any).execution || 'paper') as 'paper' | 'live');
          if (exec !== 'paper') continue;
          const lastPrice = toNum(b.runtime?.lastPrice);
          if (lastPrice === null) continue;

          // Calculate initial capital for this bot
          const lev = Number((b.config as any)?.leverage) || 1;
          const qty = Number((b.config as any)?.quantity) || 0;
          const units = lev > 0 ? qty / lev : 0;
          const startPrice = toNum(b.runtime?.startedPrice ?? b.runtime?.paperStartedPrice);
          const initialCapital = (startPrice !== null && units > 0) ? units * startPrice : 0;

          // Add realized P&L
          const realized = toNum((b.runtime as any)?.paperStats?.realizedPnl) ?? 0;

          // Calculate unrealized P&L from open positions
          let unrealized = 0;
          const pos = Array.isArray(b.runtime?.positions) ? b.runtime!.positions : [];
          for (const p of pos as any[]) {
            const pQty = toNum(p?.quantity) ?? 0;
            const entry = toNum(p?.entryPrice) ?? null;
            const side = String(p?.side || '').toLowerCase();
            if (!pQty || entry === null) continue;
            const pnl = side === 'sell' ? (entry - lastPrice) * pQty : (lastPrice - entry) * pQty;
            unrealized += pnl;
          }

          totalEquity += initialCapital + realized + unrealized;
        }
        await appendEquityPoint(ownerEmail, { mode: 'paper', label: 'PAPER Equity', value: totalEquity });
        lastEquityAppendAt.set('paper', nowAll);
      } catch {
        // ignore
      }
    }

    // Periodic Telegram summary (server-side scheduled; no browser required).
    // Controlled by /api/alerts/telegram/summary-config (intervalMinutes) stored per ownerEmail.
    if (nowAll - lastSummaryCheckAt > 30_000) {
      lastSummaryCheckAt = nowAll;
      try {
        const cfg = await getTelegramSummaryConfig(ownerEmail);
        const dueMs = (cfg.intervalMinutes || 0) * 60_000;
        const isEnabled = dueMs > 0;
        const lastSentAt = typeof cfg.lastSentAt === 'number' ? cfg.lastSentAt : 0;
        const isDue = isEnabled && (lastSentAt === 0 || nowAll - lastSentAt >= dueMs);
        if (isDue) {
          const runningCount = running.length;
          const lines: string[] = [];
          lines.push(`<b>9BOT</b> — Summary`);
          lines.push(`<b>Total bots:</b> ${bots.length} · <b>Running:</b> ${runningCount}`);
          lines.push(`<b>Time:</b> ${new Date(nowAll).toISOString()}`);
          lines.push('');

          let totalInitial = 0;
          let totalCurrent = 0;
          let totalPnl = 0;
          let totalsOk = 0;

          const show = bots.slice(0, 25);
          for (const b of show) {
            const exec = (((b.config as any)?.execution || 'paper') as 'paper' | 'live');
            const ex = ((b.config as any)?.exchange || 'delta_india') as 'delta_india' | 'delta_global';
            const exLabel = ex === 'delta_global' ? 'DG' : 'DI';
            const sym = String(b.config.symbol || '—').toUpperCase();
            const startP = toNumOrNull((b as any).runtime?.startedPrice);
            const curP = toNumOrNull((b as any).runtime?.lastPrice);
            const mult = notionalMultiplierFromBot(b);

            let pnlStr = '—';
            let initStr = '—';
            if (mult !== null && startP !== null && startP > 0 && curP !== null && curP > 0) {
              const initial = mult * startP;
              const currentVal = mult * curP;
              const pnl = (b.config.mode as any) === 'short' ? initial - currentVal : currentVal - initial;
              const pct = initial > 0 ? (pnl / initial) * 100 : null;
              initStr = `$${initial.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
              pnlStr =
                pct === null ? '—' : `${fmtPct(pct)} ($${pnl.toLocaleString(undefined, { maximumFractionDigits: 8 })})`;
              totalInitial += initial;
              totalCurrent += currentVal;
              totalPnl += pnl;
              totalsOk += 1;
            }

            lines.push(
              [
                `<b>${sym}</b> · ${exLabel} · ${exec.toUpperCase()} · ${b.isRunning ? 'RUNNING' : 'STOPPED'}`,
                `Init: ${initStr} · PnL: ${pnlStr}`,
                `Start: ${startP === null ? '—' : startP.toLocaleString(undefined, { maximumFractionDigits: 8 })} · Now: ${
                  curP === null ? '—' : curP.toLocaleString(undefined, { maximumFractionDigits: 8 })
                }`,
              ].join('\n')
            );
            lines.push('');
          }

          if (bots.length > show.length) lines.push(`<i>+ ${bots.length - show.length} more bots not shown</i>`);

          if (totalsOk > 0) {
            const pct = totalInitial > 0 ? (totalPnl / totalInitial) * 100 : null;
            lines.unshift(
              `<b>Total notional:</b> Init $${totalInitial.toLocaleString(undefined, { maximumFractionDigits: 8 })} · ` +
                `Now $${totalCurrent.toLocaleString(undefined, { maximumFractionDigits: 8 })} · ` +
                `PnL ${pct === null ? '—' : fmtPct(pct)} ($${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 8 })})`
            );
            lines.unshift('');
          }

          await sendTelegramText(lines.join('\n'));
          await markTelegramSummarySent(ownerEmail, nowAll);
        }
      } catch {
        // ignore (no telegram configured, etc.)
      }
    }

    // Stop engines for bots no longer running
    engines.forEach((entry, id) => {
      if (!running.some((b) => b.id === id)) {
        const bot = byId.get(id) || null;
        const wasRunning = lastKnownRunning.get(id) ?? true;
        // Manual stop transition: close/flatten positions before stopping engine.
        if (bot && wasRunning && bot.isRunning === false) {
          const cfg: any = bot.config || {};
          const ex = ((cfg as any).exchange || 'delta_india') as 'delta_india' | 'delta_global';
          const sym = toUpper(cfg.symbol);
          const storedPromise = readDeltaCredentials(ex);
          void storedPromise.then((stored) => {
            const baseUrl =
              stored?.baseUrl ||
              process.env.DELTA_BASE_URL ||
              (ex === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);
            void stopAndFlatten(bot, { exchange: ex, baseUrl, symbol: sym }, 'manual_stop', bot.runtime?.lastPrice ?? null);
          });
        }
        try {
          void entry.engine.stop();
        } catch {}
        engines.delete(id);
      }
    });

    for (const bot of running) {
      lastKnownRunning.set(bot.id, true);
      const ensured = await ensureEngine(bot);
      if (!ensured) continue;

      const { entry, baseUrl, symbol } = ensured;
      const now = Date.now();
      if (now - entry.lastPersistAt < 900) continue;
      entry.lastPersistAt = now;

      const lastPrice = await fetchDeltaMarkPrice(baseUrl, symbol);

      const cfg: any = bot.config || {};
      const ex = ((cfg as any).exchange || 'delta_india') as 'delta_india' | 'delta_global';
      const sym = toUpper(symbol);

      // LIVE realized PnL (best-effort) persisted into runtime for Portfolio
      if ((((cfg as any).execution || 'paper') as 'paper' | 'live') === 'live') {
        const startedAt = toNum(bot.runtime?.startedAt);
        const lastAt = entry.lastLiveStatsAt || 0;
        if (now - lastAt > 30_000) {
          entry.lastLiveStatsAt = now;
          try {
            const stats = await computeLiveRealizedPnl({ exchange: ex, baseUrl, symbol: sym, sinceMs: startedAt });
            await patchBotForUser(ownerEmail, bot.id, {
              runtime: {
                ...(bot.runtime || {}),
                liveStats: { ...stats, updatedAt: Date.now() },
              },
            }).catch(() => null);
          } catch {
            // ignore
          }
        }
      }

      // Risk 1: out of range -> stop + flatten
      if (typeof lastPrice === 'number' && Number.isFinite(lastPrice)) {
        const lo = Number(cfg.lowerRange);
        const hi = Number(cfg.upperRange);
        if (Number.isFinite(lo) && Number.isFinite(hi) && (lastPrice < lo || lastPrice > hi)) {
          await stopAndFlatten(bot, { exchange: ex, baseUrl, symbol: sym }, 'out_of_range', lastPrice);
          continue;
        }
      }

      // Risk 2: max consecutive loss (loss streak) -> stop + flatten
      const maxLoss = Number(cfg.maxConsecutiveLoss);
      if (Number.isFinite(maxLoss) && maxLoss > 0) {
        const streak = entry.engine.getStats().consecutiveLosses;
        if (streak >= maxLoss) {
          await stopAndFlatten(bot, { exchange: ex, baseUrl, symbol: sym }, `max_consecutive_loss_${maxLoss}`, lastPrice);
          continue;
        }
      }

      // Risk 3: circuit breaker (% drawdown from startedEquity) -> stop + flatten
      const cb = Number(cfg.circuitBreaker);
      const startedEquity = toNum(bot.runtime?.startedEquity);
      const startedCurrency = String(bot.runtime?.startedCurrency || '').trim();
      if (Number.isFinite(cb) && cb > 0 && startedEquity !== null && startedEquity > 0) {
        try {
          const snap = await fetchEquitySnapshotServer({ exchange: ex, baseUrl });
          // Best-effort: compare only if currency matches (if known).
          if (!startedCurrency || startedCurrency === snap.label) {
            const ddPct = ((snap.value - startedEquity) / startedEquity) * 100;
            if (ddPct <= -cb) {
              await stopAndFlatten(bot, { exchange: ex, baseUrl, symbol: sym }, `circuit_breaker_${cb}%`, lastPrice);
              continue;
            }
          }
        } catch {
          // if equity calc fails, don't stop the bot
        }
      }

      await persistRuntime(ownerEmail, bot, entry, lastPrice);
    }

    // Update last-known running state for bots we saw this tick
    for (const b of bots) lastKnownRunning.set(b.id, b.isRunning);
  };

  // Run in fork mode only (single process) to avoid duplicate orders.
  setInterval(() => void loop(), 1200);
  void loop();
}


