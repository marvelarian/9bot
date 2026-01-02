import type { GridBotConfig, GridLevel, Position, GridBotStats } from './types';

export interface ExchangeAdapter {
  getTicker(symbol: string): Promise<{ markPrice?: number; close?: number }>;
  placeOrder(req: {
    exchange?: 'delta_india' | 'delta_global';
    symbol: string;
    side: 'buy' | 'sell';
    order_type: 'market' | 'limit';
    size: number;
    price?: number;
    leverage?: number;
    // Debug/trace fields (ignored by real exchange routes)
    triggerLevelPrice?: number;
    triggerDirection?: 'above' | 'below';
    prevPrice?: number;
    currentPrice?: number;
  }): Promise<{ id: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getWalletBalances(): Promise<Array<{ asset_symbol: string; balance: string }>>;
}

export class GridBotEngine {
  private config: GridBotConfig;
  private levels: GridLevel[] = [];
  private positions: Position[] = [];
  private activeLevels: Set<string> = new Set();
  private consecutiveLosses = 0;
  private isRunning = false;
  private priceMonitoringInterval?: ReturnType<typeof setInterval>;
  private lastPrice?: number;
  // Paper (simulated) realized stats – computed from entry/exit round-trips.
  private paperClosedTrades = 0;
  private paperProfitTrades = 0;
  private paperLossTrades = 0;
  private paperRealizedPnl = 0;

  constructor(config: GridBotConfig, private exchange: ExchangeAdapter) {
    this.config = config;
    this.initializeGrid();
  }

  getConfig(): GridBotConfig {
    return this.config;
  }

  private normPrice(p: number): number {
    // Keep up to 8 decimals across the app (many coins require this).
    // Also reduces floating noise for comparisons.
    return Number(p.toFixed(8));
  }

  private initializeGrid(): void {
    const priceRange = this.config.upperRange - this.config.lowerRange;
    const gridSpacing = priceRange / (this.config.numberOfGrids - 1);

    this.levels = [];
    this.activeLevels.clear();

    for (let i = 0; i < this.config.numberOfGrids; i++) {
      const price = this.config.lowerRange + i * gridSpacing;
      const level: GridLevel = {
        id: `grid-${i}`,
        price: this.normPrice(price),
        isActive: true,
        tradeCount: 0,
      };
      this.levels.push(level);
      this.activeLevels.add(level.id);
    }

    this.config.gridSpacing = gridSpacing;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startPriceMonitoring();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.priceMonitoringInterval) clearInterval(this.priceMonitoringInterval);
    await this.cancelAllOrders();
  }

  private startPriceMonitoring(): void {
    this.priceMonitoringInterval = setInterval(async () => {
      if (!this.isRunning) return;
      const t = await this.exchange.getTicker(this.config.symbol);
      const price = t.markPrice ?? t.close;
      if (typeof price === 'number') await this.processPriceUpdate(price);
    }, 1500);
  }

  async processPriceUpdate(currentPrice: number): Promise<void> {
    if (!this.isRunning) return;

    // Only consider *actual* crossings relative to previous seen price.
    // This avoids firing on startup just because currentPrice is already above/below many levels.
    const prev = this.lastPrice;
    this.lastPrice = currentPrice;
    if (typeof prev !== 'number' || !Number.isFinite(prev)) return;

    // IMPORTANT: Only fire ONE level per tick (the first crossed in the move direction).
    // This matches the user's anti-"place orders on all crossed levels" requirement.
    const picked = this.findFirstCrossedLevel(prev, currentPrice);
    if (!picked) return;
    const { level, dir } = picked;
    try {
      await this.processLevelCross(level, dir, currentPrice, prev);
    } catch {
      // keep engine running even if an order fails (e.g. live mode blocked by IP whitelist)
    }
  }

  private findFirstCrossedLevel(
    prevPrice: number,
    currentPrice: number
  ): { level: GridLevel; dir: 'above' | 'below' } | null {
    if (!Number.isFinite(prevPrice) || !Number.isFinite(currentPrice)) return null;
    if (prevPrice === currentPrice) return null;

    const movingUp = currentPrice > prevPrice;

    // Candidate levels that are currently active and were crossed in this movement.
    const crossed = this.levels
      .filter((level) => {
        if (!this.activeLevels.has(level.id)) return false;
        if (movingUp) {
          const isCross = prevPrice < level.price && currentPrice >= level.price;
          if (!isCross) return false;
          return level.lastCrossed !== 'above';
        } else {
          const isCross = prevPrice > level.price && currentPrice <= level.price;
          if (!isCross) return false;
          return level.lastCrossed !== 'below';
        }
      })
      .sort((a, b) => (movingUp ? a.price - b.price : b.price - a.price));

    const first = crossed[0];
    if (!first) return null;
    return { level: first, dir: movingUp ? 'above' : 'below' };
  }

  private async processLevelCross(
    level: GridLevel,
    crossed: 'above' | 'below',
    currentPrice: number,
    prevPrice: number
  ): Promise<void> {
    if (this.consecutiveLosses >= this.config.maxConsecutiveLoss) return;

    // Decide if we should place an order for this crossing.
    // NOTE: We only "consume" (deactivate) the level if we actually place an order.
    const shouldPlace = () => {
      if (this.config.mode === 'long') {
        if (crossed === 'below') {
          const openBuys = this.positions.filter((p) => p.side === 'buy').length;
          return openBuys < this.config.maxPositions;
        }
        if (crossed === 'above') {
          return this.positions.some((p) => p.side === 'buy');
        }
        return false;
      }

      if (this.config.mode === 'short') {
        if (crossed === 'above') {
          const openSells = this.positions.filter((p) => p.side === 'sell').length;
          return openSells < this.config.maxPositions;
        }
        if (crossed === 'below') {
          return this.positions.some((p) => p.side === 'sell');
        }
        return false;
      }

      // neutral
      if (crossed === 'below') {
        // BUY in neutral either closes an existing SELL, or opens a new BUY.
        // Closing must be allowed even if maxPositions is reached.
        if (this.positions.some((p) => p.side === 'sell')) return true;
        const openBuys = this.positions.filter((p) => p.side === 'buy').length;
        return openBuys < this.config.maxPositions;
      }
      if (crossed === 'above') {
        // SELL in neutral either closes an existing BUY, or opens a new SELL.
        // Closing must be allowed even if maxPositions is reached.
        if (this.positions.some((p) => p.side === 'buy')) return true;
        const openSells = this.positions.filter((p) => p.side === 'sell').length;
        return openSells < this.config.maxPositions;
      }
      return false;
    };

    if (!shouldPlace()) return;

    // Determine side for this mode + crossing (only one side per tick).
    let side: 'buy' | 'sell' | null = null;
    if (this.config.mode === 'long') side = crossed === 'below' ? 'buy' : crossed === 'above' ? 'sell' : null;
    else if (this.config.mode === 'short') side = crossed === 'above' ? 'sell' : crossed === 'below' ? 'buy' : null;
    else side = crossed === 'below' ? 'buy' : crossed === 'above' ? 'sell' : null;
    if (!side) return;

    // Place order first. If it fails (e.g., insufficient margin), do NOT consume the level
    // so the engine can retry on the next valid crossing.
    await this.placeOrder(side, level, currentPrice, crossed, prevPrice);

    // Consume this level (deactivate current level; reactivate all others) only after success.
    level.lastCrossed = crossed;
    this.activeLevels.delete(level.id);
    level.isActive = false;
    this.levels.forEach((l) => {
      if (l.id !== level.id) {
        l.isActive = true;
        this.activeLevels.add(l.id);
      }
    });
  }

  private async placeOrder(
    side: 'buy' | 'sell',
    level: GridLevel,
    price: number,
    triggerDirection: 'above' | 'below',
    prevPrice: number
  ): Promise<void> {
    // IMPORTANT:
    // - Bot config `quantity` is expressed in LOTS (user input).
    // - Delta order `size` is in CONTRACTS.
    // - Actual order size (contracts) = lots * lotSize
    const lotsRaw = Number(this.config.quantity);
    const lots = Math.floor(lotsRaw);
    const lotSizeRaw = Number((this.config as any).lotSize ?? 1);
    const lotSize = Number.isFinite(lotSizeRaw) && lotSizeRaw > 0 ? Math.floor(lotSizeRaw) : 1;
    const orderSize = lots * lotSize;
    if (!Number.isFinite(orderSize) || orderSize <= 0) return;
    const order = await this.exchange.placeOrder({
      exchange: (this.config as any).exchange,
      symbol: this.config.symbol,
      side,
      order_type: 'market',
      size: orderSize,
      price,
      leverage: this.config.leverage,
      triggerLevelPrice: level.price,
      triggerDirection,
      prevPrice,
      currentPrice: price,
    });

    level.orderId = order.id;
    level.tradeCount = (level.tradeCount || 0) + 1;

    // Open/close bookkeeping + PAPER realized PnL:
    // - LONG: buy opens, sell closes one prior buy.
    // - SHORT: sell opens, buy closes one prior sell.
    // - NEUTRAL: buy closes a prior sell if present else opens; sell closes a prior buy if present else opens.
    let closed: Position | null = null;

    if (side === 'sell' && (this.config.mode === 'long' || this.config.mode === 'neutral')) {
      const idx = this.positions.findIndex((p) => p.side === 'buy');
      if (idx !== -1) closed = this.positions.splice(idx, 1)[0] || null;
      else if (this.config.mode === 'long') return; // safety: should have been prevented by pre-check
    } else if (side === 'buy' && (this.config.mode === 'short' || this.config.mode === 'neutral')) {
      const idx = this.positions.findIndex((p) => p.side === 'sell');
      if (idx !== -1) closed = this.positions.splice(idx, 1)[0] || null;
      else if (this.config.mode === 'short') return; // safety
    }

    if (closed) {
      // Realized PnL on the closed position (per round-trip).
      // For a closed BUY position: pnl = (exit - entry) * qty
      // For a closed SELL position: pnl = (entry - exit) * qty
      const entry = Number(closed.entryPrice);
      const exit = Number(price);
      const qty = Number(closed.quantity);
      if (Number.isFinite(entry) && Number.isFinite(exit) && Number.isFinite(qty)) {
        // Delta products often have contract_value != 1 (e.g. HUSD contract_value=100).
        // PnL should be scaled by contract_value.
        const cvRaw = Number((this.config as any).contractValue ?? 1);
        const cv = Number.isFinite(cvRaw) && cvRaw > 0 ? cvRaw : 1;
        const pnl = (closed.side === 'buy' ? (exit - entry) * qty : (entry - exit) * qty) * cv;
        this.paperRealizedPnl += pnl;
        this.paperClosedTrades += 1;
        if (pnl > 0) this.paperProfitTrades += 1;
        else if (pnl < 0) this.paperLossTrades += 1;

        // Risk: consecutive loss streak (applies to both PAPER and LIVE engine bookkeeping).
        // Increment on losing closures; reset to 0 on winning closures.
        if (pnl < 0) this.consecutiveLosses += 1;
        else if (pnl > 0) this.consecutiveLosses = 0;
      }

      // A closing trade does not open a new position.
      return;
    }

    this.positions.push({
      symbol: this.config.symbol,
      side,
      quantity: orderSize,
      entryPrice: price,
      orderId: order.id,
      leverage: this.config.leverage,
      timestamp: new Date(),
    });
  }

  private async cancelAllOrders(): Promise<void> {
    const ids = this.positions.map((p) => p.orderId);
    this.positions = [];
    await Promise.allSettled(ids.map((id) => this.exchange.cancelOrder(id)));
  }

  getGridLevels(): GridLevel[] {
    return [...this.levels];
  }

  getPositions(): Position[] {
    return [...this.positions];
  }

  getStats(): GridBotStats {
    const totalTrades = this.levels.reduce((sum, l) => sum + (l.tradeCount || 0), 0);
    return {
      totalTrades,
      activePositions: this.positions.length,
      consecutiveLosses: this.consecutiveLosses,
      totalPnL: 0,
      isRunning: this.isRunning,
    };
  }

  getPaperTradeStats(): {
    closedTrades: number;
    profitTrades: number;
    lossTrades: number;
    winRate: number | null;
    realizedPnl: number;
  } {
    const denom = this.paperProfitTrades + this.paperLossTrades;
    const winRate = denom > 0 ? this.paperProfitTrades / denom : null;
    return {
      closedTrades: this.paperClosedTrades,
      profitTrades: this.paperProfitTrades,
      lossTrades: this.paperLossTrades,
      winRate,
      realizedPnl: this.paperRealizedPnl,
    };
  }

  /**
   * Force-close all open positions at the given price.
   * - PAPER: updates simulated realized PnL + consecutive loss streak via normal close bookkeeping.
   * - LIVE: places market orders through the adapter; use with caution (the EC2 worker also flattens via exchange positions).
   */
  async forceCloseAllOpenPositions(currentPrice: number, reason?: 'manual_stop' | 'out_of_range' | 'circuit_breaker' | 'max_consecutive_loss') {
    if (!Number.isFinite(currentPrice)) return;
    const prev = typeof this.lastPrice === 'number' && Number.isFinite(this.lastPrice) ? this.lastPrice : currentPrice;

    // Synthetic level for traceability. This is not part of the grid and is never persisted as active.
    const level: GridLevel = {
      id: `force-close-${reason || 'manual'}`,
      price: this.normPrice(currentPrice),
      isActive: false,
      tradeCount: 0,
    };

    // Close positions one-by-one using the existing placeOrder bookkeeping.
    // This guarantees we compute paper realized PnL + loss streak consistently.
    // NOTE: placeOrder will early-return if it can't match a position, so we also guard against infinite loops.
    let guard = 0;
    while (this.positions.length > 0 && guard < 500) {
      guard += 1;
      const p = this.positions[0];
      if (!p) break;
      const closeSide: 'buy' | 'sell' = p.side === 'buy' ? 'sell' : 'buy';
      await this.placeOrder(closeSide, level, currentPrice, reason === 'out_of_range' ? 'above' : 'below', prev);
    }
  }

  updateConfig(newConfig: Partial<GridBotConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.initializeGrid();
  }

  hydrateRuntime(runtime?: {
    lastPrice?: number;
    positions?: Array<{
      symbol: string;
      side: 'buy' | 'sell';
      quantity: number;
      entryPrice: number;
      orderId: string;
      leverage: number;
      timestampMs?: number;
    }>;
    levels?: Array<{
      id: string;
      isActive: boolean;
      lastCrossed?: 'above' | 'below';
      tradeCount?: number;
    }>;
    paperStats?: {
      closedTrades?: number;
      profitTrades?: number;
      lossTrades?: number;
      realizedPnl?: number;
    };
  }): void {
    if (!runtime) return;
    if (typeof runtime.lastPrice === 'number' && Number.isFinite(runtime.lastPrice)) {
      this.lastPrice = runtime.lastPrice;
    }

    // Restore positions (helps LONG/SHORT exit checks survive HMR/reload)
    if (Array.isArray(runtime.positions)) {
      this.positions = runtime.positions
        .filter((p) => p && (p.side === 'buy' || p.side === 'sell'))
        .map((p) => ({
          symbol: String(p.symbol || this.config.symbol),
          side: p.side,
          quantity: Number(p.quantity),
          entryPrice: Number(p.entryPrice),
          orderId: String(p.orderId || ''),
          leverage: Number(p.leverage || this.config.leverage || 1),
          timestamp: new Date(typeof p.timestampMs === 'number' ? p.timestampMs : Date.now()),
        }))
        .filter((p) => Number.isFinite(p.quantity) && Number.isFinite(p.entryPrice));
    }

    // Restore per-level state (active/lastCrossed/tradeCount)
    if (Array.isArray(runtime.levels)) {
      const byId = new Map(runtime.levels.map((l) => [String(l.id), l]));
      this.activeLevels.clear();
      for (const level of this.levels) {
        const snap = byId.get(level.id);
        if (snap) {
          level.isActive = !!snap.isActive;
          level.lastCrossed = snap.lastCrossed;
          level.tradeCount = snap.tradeCount;
        }
        if (level.isActive) this.activeLevels.add(level.id);
      }
    }

    if (runtime.paperStats && typeof runtime.paperStats === 'object') {
      const c = Number((runtime.paperStats as any).closedTrades);
      const p = Number((runtime.paperStats as any).profitTrades);
      const l = Number((runtime.paperStats as any).lossTrades);
      const rp = Number((runtime.paperStats as any).realizedPnl);
      if (Number.isFinite(c) && c >= 0) this.paperClosedTrades = c;
      if (Number.isFinite(p) && p >= 0) this.paperProfitTrades = p;
      if (Number.isFinite(l) && l >= 0) this.paperLossTrades = l;
      if (Number.isFinite(rp)) this.paperRealizedPnl = rp;
    }
  }
}

