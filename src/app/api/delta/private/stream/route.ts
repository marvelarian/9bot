export const runtime = 'nodejs';

import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';

function jsonHeaders() {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeStringify(obj: any) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '"<unserializable>"';
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const intervalMs = Math.max(750, Math.min(10_000, Number(searchParams.get('intervalMs') || '1500')));

  // If client only wants specific streams
  const wantOrders = searchParams.get('orders') !== '0';
  const wantPositions = searchParams.get('positions') !== '0';
  const wantWallet = searchParams.get('wallet') !== '0';

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // Ping to establish the stream
      safeEnqueue(`event: hello\ndata: ${safeStringify({ ok: true })}\n\n`);

      (async () => {
        let lastHash = {
          orders: '',
          positions: '',
          wallet: '',
        };

        try {
          const { auth, baseUrl } = await getDeltaAuth({ req });

          while (!closed) {
            const t0 = Date.now();

            try {
              if (wantOrders) {
                const o = await deltaFetch<any>({ method: 'GET', path: '/v2/orders', auth, baseUrl });
                const payload = o?.result ?? o;
                const hash = safeStringify(payload);
                if (hash !== lastHash.orders) {
                  lastHash.orders = hash;
                  safeEnqueue(`event: orders\ndata: ${hash}\n\n`);
                }
              }

              if (wantPositions) {
                const p = await deltaFetch<any>({ method: 'GET', path: '/v2/positions/margined', auth, baseUrl });
                const payload = p?.result ?? p;
                const hash = safeStringify(payload);
                if (hash !== lastHash.positions) {
                  lastHash.positions = hash;
                  safeEnqueue(`event: positions\ndata: ${hash}\n\n`);
                }
              }

              if (wantWallet) {
                const w = await deltaFetch<any>({ method: 'GET', path: '/v2/wallet/balances', auth, baseUrl });
                const payload = w?.result ?? w;
                const hash = safeStringify(payload);
                if (hash !== lastHash.wallet) {
                  lastHash.wallet = hash;
                  safeEnqueue(`event: wallet\ndata: ${hash}\n\n`);
                }
              }

              safeEnqueue(`event: ping\ndata: ${safeStringify({ ts: Date.now() })}\n\n`);
            } catch (e: any) {
              safeEnqueue(`event: error\ndata: ${safeStringify({ message: e?.message || 'unknown' })}\n\n`);
            }

            const elapsed = Date.now() - t0;
            await sleep(Math.max(0, intervalMs - elapsed));
          }
        } catch (e: any) {
          safeEnqueue(`event: error\ndata: ${safeStringify({ message: e?.message || 'unknown' })}\n\n`);
        } finally {
          close();
        }
      })();

      // Close when client disconnects
      // @ts-ignore
      req.signal?.addEventListener?.('abort', () => close());
    },
  });

  return new Response(stream, { headers: jsonHeaders() });
}



