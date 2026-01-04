export interface GridBotConfig {
  exchange?: 'delta_india' | 'delta_global';
  execution?: 'paper' | 'live';
  symbol: string;
  lowerRange: number;
  upperRange: number;
  numberOfGrids: number;
  // Reference price captured at bot creation time (Delta ticker best-effort).
  // Used to make "grid spacing %" stable and not dependent on the current price later.
  refPriceAtCreate?: number;
  // Grid spacing percent at creation time: gridSpacing / refPriceAtCreate * 100
  gridSpacingPctAtCreate?: number;
  mode: 'long' | 'short' | 'neutral';
  // Investment baseline for per-bot PnL and drawdown calculations (INR).
  // Used for Option A: drawdown% = (currentPnLInr / investmentInr) * 100
  investment: number;
  // Quantity is ALWAYS expressed in "lots" (not Delta contracts).
  // Actual Delta order size (contracts) = quantityLots * lotSize
  quantity: number;
  // Delta product meta (best-effort, filled by server worker)
  lotSize?: number; // often product_specs.min_order_size, defaults to 1
  contractValue?: number; // contract_value, defaults to 1
  leverage: number;
  maxPositions: number;
  maxConsecutiveLoss: number;
  gridSpacing?: number;
  circuitBreaker: number;
}

export interface GridLevel {
  id: string;
  price: number;
  isActive: boolean;
  lastCrossed?: 'above' | 'below';
  orderId?: string;
  tradeCount?: number;
}

export interface Position {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  orderId: string;
  leverage: number;
  timestamp: Date;
}

export interface GridBotStats {
  totalTrades: number;
  activePositions: number;
  consecutiveLosses: number;
  totalPnL: number;
  isRunning: boolean;
  winRate?: number;
  averageTrade?: number;
}

export interface Alert {
  id: string;
  type: 'price' | 'position' | 'system' | 'risk';
  symbol?: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  isRead: boolean;
}

export interface RiskSettings {
  maxDrawdown: number;
  maxPositions: number;
  maxOrderSize: number;
  dailyLossLimit: number;
  positionSizePercentage: number;
  circuitBreakerLevels: number[];
}

export interface DeltaCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface OrderRequest {
  product_id: number;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  size: number;
  price?: number;
}

export interface OrderResponse {
  id: string;
  product_id: number;
  side: string;
  size: number;
  price: number;
  status: string;
  timestamp: Date;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  pnl?: number;
}

export interface OHLCData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

