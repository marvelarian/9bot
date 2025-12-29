export const runtime = 'nodejs';

type DeltaTickerResponse = {
  result?: any;
};

import { readDeltaCredentials } from '@/lib/delta-credentials-store';
import { DEFAULT_DELTA_BASE_URL, DELTA_INDIA_BASE_URL } from '@/lib/delta-signing';

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function fetchDeltaTicker(baseUrl: string, symbol: string) {
  const res = await fetch(`${baseUrl}/v2/tickers/${encodeURIComponent(symbol)}`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Delta ticker failed: ${res.status}`);
  const json = (await res.json()) as DeltaTickerResponse;
  const t = json.result ?? {};

  const toNum = (v: any): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  // Delta sometimes returns numbers as strings; normalize.
  // Delta uses snake_case in most responses; keep both to be safe.
  const markPrice =
    toNum(t.mark_price) ??
    toNum(t.markPrice) ??
    toNum(t.mark) ??
    toNum(t.last_price) ??
    toNum(t.lastPrice) ??
    toNum(t.close) ??
    undefined;
  return {
    symbol,
    ts: Date.now(),
    markPrice,
    raw: t,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'BTCUSD').toUpperCase();
  const intervalMs = Math.max(500, Math.min(5000, Number(searchParams.get('intervalMs') || '1000')));
  const exchangeParam = searchParams.get('exchange') || undefined;

  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;)\s*exchange=([^;]+)/);
  const exchange = m ? decodeURIComponent(m[1]) : undefined;
  const chosen = (exchangeParam || exchange) as any;
  const stored = await readDeltaCredentials(chosen);
  const baseUrl =
    stored?.baseUrl ||
    process.env.DELTA_BASE_URL ||
    (chosen === 'delta_india' ? DELTA_INDIA_BASE_URL : DEFAULT_DELTA_BASE_URL);

  const encoder = new TextEncoder();

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const safeEnqueue = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) => {
    if (closed) return;
    try {
      controller.enqueue(chunk);
    } catch {
      // If enqueue fails, treat the stream as closed and stop all work.
      closeStream(controller);
    }
  };

  const closeStream = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      controller?.close();
    } catch {
      // ignore
    }
  };

  const scheduleNext = (fn: () => void, delayMs: number) => {
    if (closed) return;
    timer = setTimeout(fn, delayMs);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Stop streaming when client disconnects
      req.signal?.addEventListener?.('abort', () => closeStream(controller));

      safeEnqueue(
        controller,
        encoder.encode(['retry: 1500\n', 'event: hello\n', sse({ ok: true, symbol, intervalMs })].join(''))
      );

      const pump = async () => {
        if (closed) return;
        try {
          const tick = await fetchDeltaTicker(baseUrl, symbol);
          safeEnqueue(controller, encoder.encode(sse(tick)));
        } catch (e: any) {
          try {
            safeEnqueue(
              controller,
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ ok: false, symbol, baseUrl, message: e?.message || 'unknown' })}\n\n`
              )
            );
          } catch {
            closeStream(controller);
            return;
          }
        }
        scheduleNext(() => void pump(), intervalMs);
      };

      scheduleNext(() => void pump(), intervalMs);
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}


