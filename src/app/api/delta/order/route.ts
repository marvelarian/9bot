export const runtime = 'nodejs';

import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';
import { getDeltaProductMeta } from '@/lib/delta-products';
import { normalizeDeltaOrderSize } from '@/lib/delta-order-sizing';
import { sendTelegramText } from '@/lib/telegram-send';

type PlaceBody = {
  exchange?: 'delta_india' | 'delta_global';
  symbol?: string;
  product_id?: number;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  size: number;
  price?: number;
  leverage?: number;
};

function toDeltaOrderType(t: PlaceBody['order_type']): 'market_order' | 'limit_order' {
  return t === 'limit' ? 'limit_order' : 'market_order';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlaceBody;
    if (!body?.side || !body?.order_type || !Number.isFinite(Number(body?.size))) {
      return Response.json({ ok: false, error: 'side, order_type, size are required' }, { status: 400 });
    }

    const { auth, baseUrl } = await getDeltaAuth({ req, exchange: body.exchange });

    const product =
      typeof body.product_id === 'number' && Number.isFinite(body.product_id)
        ? ({ id: body.product_id, symbol: String(body.symbol || '') } as any)
        : body.symbol
          ? await getDeltaProductMeta({ baseUrl, symbol: body.symbol })
          : null;

    const product_id = product?.id;
    if (!product_id) {
      return Response.json({ ok: false, error: 'Provide product_id or symbol' }, { status: 400 });
    }

    const normalized = normalizeDeltaOrderSize({ requestedSize: Number(body.size), product });

    // Best-effort: apply order leverage for this product (isolated-style leverage per contract on Delta).
    try {
      const levRaw = Number(body.leverage);
      const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : null;
      if (lev !== null) {
        await deltaFetch<any>({
          method: 'POST',
          path: `/v2/products/${product_id}/orders/leverage`,
          auth,
          baseUrl,
          body: { leverage: String(lev) },
        });
      }
    } catch {
      // ignore: don't block order if leverage call fails
    }

    const payload: any = {
      product_id,
      side: body.side,
      order_type: toDeltaOrderType(body.order_type),
      size: normalized.size,
    };
    if (body.order_type === 'limit' && typeof body.price === 'number' && Number.isFinite(body.price)) {
      payload.price = body.price;
    }

    const res = await deltaFetch<any>({
      method: 'POST',
      path: '/v2/orders',
      auth,
      baseUrl,
      body: payload,
    });

    const order = res?.result ?? res;
    const id = order?.id || order?.order_id || order?.uuid;

    // Telegram: order placed (best-effort)
    try {
      const sym = body.symbol ? body.symbol.toUpperCase() : undefined;
      const exLabel = body.exchange === 'delta_global' ? 'Delta Global' : 'Delta India';
      const px =
        typeof body.price === 'number' && Number.isFinite(body.price) ? ` @ ${body.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '';
      await sendTelegramText(
        [
          `<b>9BOT</b> — Order placed ✅`,
          `<b>Exchange:</b> ${exLabel}`,
          sym ? `<b>Symbol:</b> ${sym}` : null,
          `<b>Side:</b> ${body.side.toUpperCase()}`,
          `<b>Type:</b> ${body.order_type.toUpperCase()}`,
          `<b>Size:</b> ${normalized.size}${normalized.adjusted ? ` (adj from ${Number(body.size)})` : ''}`,
          px ? `<b>Price:</b> ${px.replace(' @ ', '')}` : null,
          id ? `<b>Order ID:</b> ${id}` : null,
          `<b>Time:</b> ${new Date().toISOString()}`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch {
      // ignore
    }

    return Response.json({ ok: true, result: order, id: id || null, normalizedSize: normalized.size, sizeAdjusted: normalized.adjusted });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown', delta: e?.delta }, { status: e?.status || 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId') || searchParams.get('id');
    const exchange = searchParams.get('exchange') || undefined;
    if (!orderId) return Response.json({ ok: false, error: 'orderId is required' }, { status: 400 });

    const { auth, baseUrl } = await getDeltaAuth({ req, exchange });

    // Delta commonly uses DELETE /v2/orders/{id} to cancel.
    const res = await deltaFetch<any>({
      method: 'DELETE',
      path: `/v2/orders/${encodeURIComponent(orderId)}`,
      auth,
      baseUrl,
    });
    return Response.json({ ok: true, result: res?.result ?? res });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown', delta: e?.delta }, { status: e?.status || 500 });
  }
}


