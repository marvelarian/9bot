import { DeltaCredentials, OrderRequest, OrderResponse } from './types';

export class DeltaAPI {
  private baseURL = 'https://api.delta.exchange';
  private credentials: DeltaCredentials;

  constructor(credentials: DeltaCredentials) {
    this.credentials = credentials;
  }

  private generateSignature(timestamp: string, method: string, path: string, body?: string): string {
    const message = timestamp + method + path + (body || '');
    return require('crypto').createHmac('sha256', this.credentials.apiSecret)
      .update(message)
      .digest('hex');
  }

  private async makeRequest(method: string, path: string, body?: any): Promise<any> {
    // Prefer IPv4 for Delta calls to keep IP whitelist stable (avoid switching to IPv6).
    // This older wrapper is not used by most of the app, but keep behavior consistent.
    try {
      await import('@/lib/server/delta-http');
    } catch {}

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const url = `${this.baseURL}${path}`;

    const signature = this.generateSignature(timestamp, method, path, body ? JSON.stringify(body) : undefined);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-key': this.credentials.apiKey,
      'timestamp': timestamp,
      'signature': signature,
    };

    const config: RequestInit = {
      method,
      headers,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      throw new Error(`Delta API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    const response = await this.makeRequest('POST', '/v2/orders', order);
    return {
      ...response.result,
      timestamp: new Date()
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    return this.makeRequest('DELETE', `/v2/orders/${orderId}`);
  }

  async getPositions(): Promise<any[]> {
    const response = await this.makeRequest('GET', '/v2/positions/margined');
    return response.result || [];
  }

  async getOrders(): Promise<any[]> {
    const response = await this.makeRequest('GET', '/v2/orders');
    return response.result || [];
  }

  async getWalletBalances(): Promise<any[]> {
    const response = await this.makeRequest('GET', '/v2/wallet/balances');
    return response.result || [];
  }

  async getProducts(): Promise<any[]> {
    const response = await this.makeRequest('GET', '/v2/products');
    return response.result || [];
  }

  async getTicker(symbol: string): Promise<any> {
    const response = await this.makeRequest('GET', `/v2/tickers/${symbol}`);
    return response.result;
  }

  async getOrderbook(productId: number): Promise<any> {
    const response = await this.makeRequest('GET', `/v2/l2orderbook/${productId}`);
    return response.result;
  }

  async getTradeHistory(symbol: string, limit = 100): Promise<any[]> {
    const response = await this.makeRequest('GET', `/v2/trades/${symbol}?limit=${limit}`);
    return response.result || [];
  }

  // Get historical OHLC data
  async getHistoricalData(symbol: string, resolution: string = '1m', limit = 100): Promise<any[]> {
    const response = await this.makeRequest('GET', `/v2/history/candles?symbol=${symbol}&resolution=${resolution}&limit=${limit}`);
    return response.result || [];
  }
}

