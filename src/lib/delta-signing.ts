export const DEFAULT_DELTA_BASE_URL = 'https://api.delta.exchange';
export const DELTA_INDIA_BASE_URL = 'https://api.india.delta.exchange';

export type DeltaAuthEnv = {
  apiKey: string;
  apiSecret: string;
};

function parseCookie(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function getDeltaAuth(opts?: { exchange?: string; req?: Request }): Promise<{ auth: DeltaAuthEnv; baseUrl: string; exchange?: string }> {
  // Prefer stored credentials (one-time setup) over env.
  const { readDeltaCredentials } = await import('@/lib/delta-credentials-store');
  const cookieExchange = opts?.req ? parseCookie(opts.req.headers.get('cookie'))?.exchange : undefined;
  const exchange = (opts?.exchange || cookieExchange) as any;
  const stored = await readDeltaCredentials(exchange);
  if (stored?.apiKey && stored?.apiSecret) {
    return {
      auth: { apiKey: stored.apiKey, apiSecret: stored.apiSecret },
      baseUrl: stored.baseUrl || process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL,
      exchange,
    };
  }

  const apiKey = process.env.DELTA_API_KEY;
  const apiSecret = process.env.DELTA_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing Delta credentials. Configure via API Integration or set DELTA_API_KEY/DELTA_API_SECRET.');
  }
  return {
    auth: { apiKey, apiSecret },
    baseUrl: process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL,
    exchange,
  };
}

export function signDeltaRequest(params: {
  apiSecret: string;
  timestamp: string;
  method: string;
  path: string;
  body?: string;
}): string {
  // Based on Delta docs: signature = HMAC_SHA256(secret, timestamp + method + path + body)
  // NOTE: Delta error responses include signature_data like: "GET<timestamp>/v2/..."
  // which implies the canonical string is: method + timestamp + path + body
  // See: https://docs.delta.exchange/#introduction
  const crypto = require('crypto') as typeof import('crypto');
  const message = params.method + params.timestamp + params.path + (params.body || '');
  return crypto.createHmac('sha256', params.apiSecret).update(message).digest('hex');
}

export async function deltaFetch<T>(params: {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: any;
  auth?: DeltaAuthEnv;
  baseUrl?: string;
}): Promise<T> {
  const url = `${params.baseUrl || process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL}${params.path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    // Some CDNs (CloudFront) block requests that look "bot-like" without a UA.
    'user-agent': '9bot/1.0 (+https://localhost)',
  };

  const bodyStr = params.body ? JSON.stringify(params.body) : '';

  if (params.auth) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signDeltaRequest({
      apiSecret: params.auth.apiSecret,
      timestamp,
      method: params.method,
      path: params.path,
      body: params.body ? bodyStr : undefined,
    });

    headers['api-key'] = params.auth.apiKey;
    headers['timestamp'] = timestamp;
    headers['signature'] = signature;
  }

  // Force IPv4 egress for Delta (stable whitelist IP).
  const { requestJsonIPv4 } = await import('@/lib/server/delta-http');
  const out = await requestJsonIPv4({
    url,
    method: params.method,
    headers,
    body: params.body ? bodyStr : undefined,
  });

  const json = out.json;
  if (!out.ok) {
    // Server-side debug log (no secrets).
    try {
      const { appendDeltaLog } = await import('@/lib/server-log');
      const apiKeyMasked = params.auth?.apiKey ? `${params.auth.apiKey.slice(0, 4)}****${params.auth.apiKey.slice(-4)}` : undefined;
      const safeBody = params.body ? { hasBody: true, keys: Object.keys(params.body || {}) } : { hasBody: false };
      const safeJson =
        json && typeof json === 'object'
          ? {
              // keep only the most useful fields
              message: (json as any)?.message,
              error: (json as any)?.error,
              code: (json as any)?.code,
            }
          : json;

      await appendDeltaLog({
        level: 'error',
        baseUrl: params.baseUrl || process.env.DELTA_BASE_URL || DEFAULT_DELTA_BASE_URL,
        path: params.path,
        method: params.method,
        status: out.status,
        statusText: out.status === 401 ? 'Unauthorized' : 'Error',
        apiKeyMasked,
        request: safeBody,
        response: safeJson,
      });
    } catch {
      // ignore
    }

    const msg =
      (json && ((json as any).error?.message || (json as any).message || (json as any).error?.code || (json as any).code)) ||
      `${out.status}`;
    const err: any = new Error(`Delta API error: ${msg}`);
    err.status = out.status;
    err.statusText = out.status === 401 ? 'Unauthorized' : 'Error';
    err.delta = json;
    throw err;
  }
  return json as T;
}


