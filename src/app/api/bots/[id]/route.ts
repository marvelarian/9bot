export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { archiveBotForUser, getBotForUser, patchBotForUser } from '@/lib/server/bots-store';
import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';
import { getDeltaProductMeta } from '@/lib/delta-products';
import { normalizeDeltaOrderSize } from '@/lib/delta-order-sizing';
import { sendTelegramText } from '@/lib/telegram-send';
import { appendAudit } from '@/lib/server/audit-log-store';

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

function pickPosSide(p: any): 'buy' | 'sell' | null {
  const s = String(p?.side ?? p?.position_side ?? p?.direction ?? p?.order_side ?? '').toLowerCase();
  if (s === 'buy' || s === 'long') return 'buy';
  if (s === 'sell' || s === 'short') return 'sell';
  const sizeRaw =
    toNum(p?.size) ??
    toNum(p?.position_size) ??
    toNum(p?.quantity) ??
    toNum(p?.net_quantity) ??
    toNum(p?.net_size) ??
    toNum(p?.position_qty) ??
    0;
  if (sizeRaw === null) return null;
  return sizeRaw > 0 ? 'buy' : sizeRaw < 0 ? 'sell' : null;
}

function pickPosSizeAbs(p: any): number {
  const sizeRaw =
    toNum(p?.size) ??
    toNum(p?.position_size) ??
    toNum(p?.quantity) ??
    toNum(p?.net_quantity) ??
    toNum(p?.net_size) ??
    toNum(p?.position_qty) ??
    0;
  const n = typeof sizeRaw === 'number' ? sizeRaw : 0;
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

async function flattenSymbolAllPositionsLive(params: { req: Request; exchange?: string | null; symbol: string }) {
  const { auth, baseUrl } = await getDeltaAuth({ req: params.req, exchange: params.exchange || undefined });
  const sym = toUpper(params.symbol);
  if (!sym) return;

  const product = await getDeltaProductMeta({ baseUrl, symbol: sym });
  const product_id = product.id;

  const fetchOpen = async () => {
    const posRes = await deltaFetch<any>({ method: 'GET', path: '/v2/positions/margined', auth, baseUrl });
    const pos = Array.isArray(posRes?.result) ? posRes.result : Array.isArray(posRes) ? posRes : [];
    const open: Array<{ side: 'buy' | 'sell'; sizeAbs: number }> = [];
    for (const p of pos as any[]) {
      const ps = toUpper(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? p?.productSymbol);
      if (!ps || ps !== sym) continue;
      const side = pickPosSide(p);
      const sizeAbs = pickPosSizeAbs(p);
      if (!side || !Number.isFinite(sizeAbs) || sizeAbs <= 0) continue;
      open.push({ side, sizeAbs });
    }
    return open;
  };

  const open = await fetchOpen();
  if (!open.length) return;

  // STRICT: place closing market orders (normalized), throw if any fails.
  for (const p of open) {
    const closeSide = p.side === 'buy' ? 'sell' : 'buy';
    const normalized = normalizeDeltaOrderSize({ requestedSize: Number(p.sizeAbs), product });
    await deltaFetch<any>({
      method: 'POST',
      path: '/v2/orders',
      auth,
      baseUrl,
      body: { product_id, side: closeSide, order_type: 'market_order', size: normalized.size },
    });
  }

  // STRICT: re-check and fail if any positions remain.
  const remaining = await fetchOpen();
  if (remaining.length) {
    throw new Error(`flatten_failed_remaining_positions:${sym}:${remaining.length}`);
  }
}

async function computeSymbolPnlInrFromDelta(params: {
  req: Request;
  exchange?: string | null;
  symbol: string;
  sinceMs: number | null;
}): Promise<{ realizedInr: number; unrealizedInr: number; pnlInr: number }> {
  const { auth, baseUrl } = await getDeltaAuth({ req: params.req, exchange: params.exchange || undefined });
  const sym = toUpper(params.symbol);

  // Fills: realized INR (prefer realized_pnl_inr if present)
  const qs = new URLSearchParams();
  qs.set('symbol', sym);
  qs.set('limit', '1000');
  if (typeof params.sinceMs === 'number' && Number.isFinite(params.sinceMs)) {
    qs.set('start_time', String(Math.floor(params.sinceMs / 1000)));
  }
  const fillsRes = await deltaFetch<any>({ method: 'GET', path: `/v2/fills?${qs.toString()}`, auth, baseUrl }).catch(() => null);
  const fills = Array.isArray(fillsRes?.result) ? fillsRes.result : Array.isArray(fillsRes) ? fillsRes : [];

  let realized = 0;
  let sawInr = false;
  for (const f of fills as any[]) {
    const fs = toUpper(f?.product_symbol || f?.symbol || f?.product?.symbol);
    if (fs && fs !== sym) continue;
    const rpInr = toNum(f?.realized_pnl_inr);
    if (rpInr !== null) {
      realized += rpInr;
      sawInr = true;
      continue;
    }
    if (!sawInr) {
      const rp = toNum(f?.realized_pnl ?? f?.realizedPnl ?? f?.pnl ?? f?.profit ?? f?.trade_pnl);
      if (rp !== null) realized += rp;
    }
  }

  // Positions: unrealized INR (prefer unrealized_pnl_inr if present)
  const posRes = await deltaFetch<any>({ method: 'GET', path: '/v2/positions/margined', auth, baseUrl }).catch(() => null);
  const pos = Array.isArray(posRes?.result) ? posRes.result : Array.isArray(posRes) ? posRes : [];

  let unrealized = 0;
  for (const p of pos as any[]) {
    const ps = toUpper(p?.product_symbol ?? p?.symbol ?? p?.product?.symbol ?? p?.productSymbol);
    if (!ps || ps !== sym) continue;
    const upInr = toNum(p?.unrealized_pnl_inr);
    if (upInr !== null) {
      unrealized += upInr;
      continue;
    }
    const up = toNum(p?.unrealized_pnl ?? p?.unrealizedPnl);
    if (up !== null) unrealized += up;
  }

  const pnl = realized + unrealized;
  return { realizedInr: realized, unrealizedInr: unrealized, pnlInr: pnl };
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const email = await requireAuthedEmail();
    const id = String(ctx?.params?.id || '');
    const body = await req.json().catch(() => ({}));
    const patch = body?.patch || {};

    const bot = await patchBotForUser(email, id, patch);
    if (!bot) return NextResponse.json({ ok: false, error: 'conflict_or_not_found' }, { status: 409 });
    return NextResponse.json({ ok: true, bot });
  } catch (e: any) {
    const msg = e?.message || 'update failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const email = await requireAuthedEmail();
    const id = String(ctx?.params?.id || '');

    // Soft-delete: capture a frozen per-bot performance snapshot (Option A) at delete time.
    const bot = await getBotForUser(email, id, { includeDeleted: true });
    if (!bot) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    // If already deleted, keep idempotent.
    if (bot.deletedAt) return NextResponse.json({ ok: true, archived: true, already: true });

    const cfg: any = bot.config || {};
    const exchange = (cfg.exchange || 'delta_india') as string;
    const symbol = toUpper(cfg.symbol);
    const investmentInr = toNum(cfg.investment) ?? 0;
    const startedAt = toNum((bot.runtime as any)?.startedAt) ?? null;
    const exec = String(cfg.execution || 'paper');

    // Stop bot first (prevents new orders while deleting). Best-effort.
    await patchBotForUser(email, id, { isRunning: false }).catch(() => null);

    // LIVE delete: STRICT flatten all exchange positions for this symbol BEFORE archiving.
    // If flatten fails, do NOT archive.
    if (exec === 'live' && symbol) {
      try {
        await flattenSymbolAllPositionsLive({ req: _req, exchange, symbol });
      } catch (e: any) {
        // Telegram + audit log best-effort
        try {
          await appendAudit({
            ts: Date.now(),
            level: 'error',
            ownerEmail: email,
            botId: id,
            exchange: String(exchange || ''),
            symbol,
            event: 'flatten_failed',
            message: `Delete flatten failed: ${String(e?.message || 'flatten_failed')}`,
          });
        } catch {}
        try {
          await sendTelegramText(
            [
              `<b>9BOT</b> — Delete failed (flatten failed) ⚠️`,
              `<b>Bot:</b> ${id}`,
              `<b>Symbol:</b> ${symbol}`,
              `<b>Exchange:</b> ${String(exchange || '')}`,
              `<b>Detail:</b> ${String(e?.message || 'flatten_failed')}`,
              `<b>Time:</b> ${new Date().toISOString()}`,
            ].join('\n')
          );
        } catch {}
        return NextResponse.json(
          { ok: false, error: 'flatten_failed', detail: String(e?.message || 'flatten_failed') },
          { status: 409 }
        );
      }
    }

    let snap = { realizedInr: 0, unrealizedInr: 0, pnlInr: 0 };
    try {
      if (symbol) {
        snap = await computeSymbolPnlInrFromDelta({ req: _req, exchange, symbol, sinceMs: startedAt });
      }
    } catch {
      // best-effort snapshot
    }

    const pnlInr = snap.pnlInr;
    const roePct = investmentInr > 0 ? (pnlInr / investmentInr) * 100 : 0;
    const now = Date.now();

    // Persist snapshot and archive.
    const archived = await archiveBotForUser(email, id, {
      runtime: {
        ...(bot.runtime || {}),
        deletedSnapshot: {
          at: now,
          currency: 'INR',
          investmentInr,
          realizedInr: snap.realizedInr,
          unrealizedInr: snap.unrealizedInr,
          pnlInr,
          roePct,
          currentInr: investmentInr + pnlInr,
        },
      },
    });

    // Also ensure isRunning is false at store level (archive already does this, but keep PATCH behavior consistent).
    if (archived && bot.isRunning) {
      await patchBotForUser(email, id, { isRunning: false }).catch(() => null);
    }

    return NextResponse.json({ ok: true, archived: true });
  } catch (e: any) {
    const msg = e?.message || 'delete failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






