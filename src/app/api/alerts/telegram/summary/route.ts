export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { listBots } from '@/lib/server/bots-store';
import { sendTelegramText } from '@/lib/telegram-send';
import { getTelegramSummaryConfig, markTelegramSummarySent } from '@/lib/server/telegram-summary-store';
import { deltaFetch, getDeltaAuth } from '@/lib/delta-signing';

function toNum(v: any): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toUpper(s: any) {
  return String(s || '').trim().toUpperCase();
}

async function computeSymbolPnlInr(params: {
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

export async function POST(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const cfg = await getTelegramSummaryConfig(email);
    if (!force && (!cfg.intervalMinutes || cfg.intervalMinutes <= 0)) {
      return NextResponse.json({ ok: true, sent: false, reason: 'disabled' });
    }

    const now = Date.now();
    const dueMs = (cfg.intervalMinutes || 0) * 60_000;
    if (!force && dueMs > 0 && typeof cfg.lastSentAt === 'number' && now - cfg.lastSentAt < dueMs) {
      return NextResponse.json({ ok: true, sent: false, reason: 'not_due', nextInMs: dueMs - (now - cfg.lastSentAt) });
    }

    const bots = await listBots(email);
    const running = bots.filter((b) => b.isRunning);

    let totalInvestmentInr = 0;
    let totalCurrentInr = 0;
    let totalPnlInr = 0;
    let totalsOk = 0;

    const lines: string[] = [];
    lines.push(`<b>9BOT</b> — Summary`);
    lines.push(`<b>Total bots:</b> ${bots.length} · <b>Running:</b> ${running.length}`);
    lines.push(`<b>Time:</b> ${new Date(now).toISOString()}`);
    lines.push('');

    const show = bots.slice(0, 25); // prevent huge telegram messages
    for (const b of show) {
      const exec = (((b.config as any)?.execution || 'paper') as 'paper' | 'live');
      const ex = ((b.config as any)?.exchange || 'delta_india') as string;
      const exLabel = ex === 'delta_global' ? 'DG' : 'DI';
      const sym = String(b.config.symbol || '—').toUpperCase();

      // Match UI: Investment (INR) baseline + symbol PnL (INR) => ROE%
      const investmentInr = toNum((b.config as any)?.investment) ?? 0;
      const startedAt = toNum((b as any)?.runtime?.startedAt) ?? null;
      let pnlInr: number | null = null;
      let realizedInr: number | null = null;
      let unrealizedInr: number | null = null;

      if (exec === 'live' && b.isRunning && sym && investmentInr > 0) {
        try {
          const s = await computeSymbolPnlInr({ req, exchange: ex, symbol: sym, sinceMs: startedAt });
          pnlInr = s.pnlInr;
          realizedInr = s.realizedInr;
          unrealizedInr = s.unrealizedInr;
        } catch {
          // best-effort
        }
      }

      // PAPER: best-effort simulated PnL from runtime (currency is "SIM", but we still compute ROE% vs investment INR).
      if (exec === 'paper' && investmentInr > 0) {
        const realized = toNum((b as any)?.runtime?.paperStats?.realizedPnl) ?? 0;
        const lastPrice = toNum((b as any)?.runtime?.lastPrice);
        const cv = toNum((b as any)?.runtime?.contractValue ?? (b.config as any)?.contractValue) ?? 1;
        let unreal = 0;
        const pos = Array.isArray((b as any)?.runtime?.positions) ? ((b as any).runtime.positions as any[]) : [];
        if (lastPrice !== null) {
          for (const p of pos) {
            const qty = toNum(p?.quantity) ?? 0;
            const entry = toNum(p?.entryPrice);
            const side = String(p?.side || '').toLowerCase();
            if (!qty || entry === null) continue;
            const raw = side === 'sell' ? (entry - lastPrice) * qty : (lastPrice - entry) * qty;
            unreal += raw * (cv > 0 ? cv : 1);
          }
        }
        pnlInr = realized + unreal;
        realizedInr = realized;
        unrealizedInr = unreal;
      }

      const roePct = investmentInr > 0 && pnlInr !== null ? (pnlInr / investmentInr) * 100 : null;
      const currentInr = investmentInr > 0 && pnlInr !== null ? investmentInr + pnlInr : null;

      if (investmentInr > 0 && pnlInr !== null && currentInr !== null && Number.isFinite(roePct ?? NaN)) {
        totalInvestmentInr += investmentInr;
        totalCurrentInr += currentInr;
        totalPnlInr += pnlInr;
        totalsOk += 1;
      }

      lines.push(
        [
          `<b>${sym}</b> · ${exLabel} · ${exec.toUpperCase()} · ${b.isRunning ? 'RUNNING' : 'STOPPED'}`,
          investmentInr > 0
            ? `Investment: INR ${investmentInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : 'Investment: —',
          pnlInr === null
            ? `PnL: —`
            : `PnL: INR ${pnlInr >= 0 ? '+' : ''}${pnlInr.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ` +
              `ROE ${roePct === null ? '—' : `${roePct >= 0 ? '+' : ''}${roePct.toFixed(2)}%`}` +
              (realizedInr !== null && unrealizedInr !== null
                ? ` (R ${realizedInr >= 0 ? '+' : ''}${realizedInr.toLocaleString(undefined, { maximumFractionDigits: 2 })}, U ${unrealizedInr >= 0 ? '+' : ''}${unrealizedInr.toLocaleString(undefined, { maximumFractionDigits: 2 })})`
                : ''),
        ].join('\n')
      );
      lines.push('');
    }

    if (bots.length > show.length) {
      lines.push(`<i>+ ${bots.length - show.length} more bots not shown</i>`);
    }

    if (totalsOk > 0) {
      const pct = totalInvestmentInr > 0 ? (totalPnlInr / totalInvestmentInr) * 100 : null;
      lines.unshift(
        `<b>Total (INR):</b> Invest ${totalInvestmentInr.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ` +
          `Now ${totalCurrentInr.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ` +
          `PnL ${totalPnlInr >= 0 ? '+' : ''}${totalPnlInr.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ` +
          `ROE ${pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}`
      );
      lines.unshift('');
    }

    await sendTelegramText(lines.join('\n'));
    await markTelegramSummarySent(email, now);

    return NextResponse.json({ ok: true, sent: true, at: now });
  } catch (e: any) {
    const msg = e?.message || 'summary failed';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






