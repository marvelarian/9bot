import type { GridBotConfig } from '@/lib/types';

export type BotRuntimePosition = {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  orderId: string;
  leverage: number;
  timestampMs: number;
};

export type BotRuntimeOrder = {
  id: string;
  exchange?: 'delta_india' | 'delta_global';
  execution: 'paper' | 'live';
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  size: number;
  price?: number;
  createdAtMs: number;
  status?: 'submitted' | 'filled' | 'rejected' | 'cancelled';
  error?: string;
  triggerLevelPrice?: number;
  triggerDirection?: 'above' | 'below';
  prevPrice?: number;
  currentPrice?: number;
};

export type BotRecord = {
  id: string;
  name: string;
  ownerEmail?: string;
  config: GridBotConfig & {
    exchange?: 'delta_india' | 'delta_global';
    execution?: 'paper' | 'live';
  };
  isRunning: boolean;
  // Soft-delete support. Deleted bots are hidden from most pages, but their performance can be shown in Portfolio.
  deletedAt?: number;
  runtime?: {
    lastPrice?: number;
    updatedAt?: number;
    // Delta product sizing (best-effort from server worker)
    lotSize?: number;
    contractValue?: number;
    // Risk/runtime (computed by engine/worker)
    consecutiveLosses?: number;
    riskStopReason?: string;
    riskStoppedAt?: number;
    startedAt?: number;
    startedEquity?: number;
    startedCurrency?: string;
    startedPrice?: number; // first price observed after bot start (PnL baseline for paper/live notional)
    paperStartedPrice?: number; // first price observed after bot start (paper PnL baseline)
    positions?: BotRuntimePosition[];
    orders?: BotRuntimeOrder[];
    paperStats?: {
      closedTrades?: number;
      profitTrades?: number;
      lossTrades?: number;
      winRate?: number;
      realizedPnl?: number;
    };
    liveStats?: {
      realizedPnl?: number;
      winTrades?: number;
      lossTrades?: number;
      winRate?: number;
      sinceMs?: number;
      updatedAt?: number;
    };
    // Frozen performance snapshot captured at delete time (Option A).
    // Currency is INR (Delta India).
    deletedSnapshot?: {
      at: number;
      currency: 'INR';
      investmentInr: number;
      realizedInr: number;
      unrealizedInr: number;
      pnlInr: number;
      roePct: number;
      currentInr: number;
    };
    levels?: Array<{
      id: string;
      price: number;
      isActive: boolean;
      lastCrossed?: 'above' | 'below';
      tradeCount?: number;
    }>;
  };
  createdAt: number;
  updatedAt: number;
};

export type ActivityEvent = {
  id: string;
  type: 'bot.created' | 'bot.started' | 'bot.stopped' | 'bot.deleted' | 'bots.emergency_stop';
  botId?: string;
  symbol?: string;
  name?: string;
  exchange?: 'delta_india' | 'delta_global';
  ts: number;
  ownerEmail?: string;
};


