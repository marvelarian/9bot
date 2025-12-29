import { RiskSettings, Position, OrderRequest } from './types';

export class RiskManager {
  private settings: RiskSettings;
  private dailyLoss = 0;
  private lastResetDate = new Date().toDateString();

  constructor(settings: RiskSettings) {
    this.settings = settings;
  }

  validateOrder(order: OrderRequest, currentPositions: Position[], accountBalance: number): boolean {
    // Reset daily loss if it's a new day
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyLoss = 0;
      this.lastResetDate = today;
    }

    // Check daily loss limit
    if (this.dailyLoss >= this.settings.dailyLossLimit) {
      return false;
    }

    // Check position limits
    if (currentPositions.length >= this.settings.maxPositions) {
      return false;
    }

    // Check order size limits
    if (order.size > this.settings.maxOrderSize) {
      return false;
    }

    // Check position sizing (percentage of account)
    const maxPositionSize = accountBalance * (this.settings.positionSizePercentage / 100);
    const orderValue = order.size * (order.price || 1); // Fallback to 1 if no price
    if (orderValue > maxPositionSize) {
      return false;
    }

    // Check drawdown (simplified - would need historical data)
    const totalPositionValue = currentPositions.reduce((sum, pos) =>
      sum + (pos.quantity * pos.entryPrice), 0);

    if (totalPositionValue > accountBalance * (1 - this.settings.maxDrawdown / 100)) {
      return false;
    }

    return true;
  }

  recordLoss(lossAmount: number): void {
    this.dailyLoss += lossAmount;
  }

  getRiskMetrics(): any {
    return {
      dailyLoss: this.dailyLoss,
      dailyLossLimit: this.settings.dailyLossLimit,
      maxDrawdown: this.settings.maxDrawdown,
      maxPositions: this.settings.maxPositions,
      positionSizePercentage: this.settings.positionSizePercentage
    };
  }

  shouldTriggerCircuitBreaker(currentLoss: number): boolean {
    return currentLoss >= this.settings.dailyLossLimit ||
           this.dailyLoss >= this.settings.dailyLossLimit;
  }

  resetDailyLoss(): void {
    this.dailyLoss = 0;
    this.lastResetDate = new Date().toDateString();
  }
}

