export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { listBots } from '@/lib/server/bots-store';
import { formatPrice } from '@/lib/format';
import { sendTelegramText } from '@/lib/telegram-send';
import { getTelegramSummaryConfig, markTelegramSummarySent } from '@/lib/server/telegram-summary-store';

function toNum(v: any): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Qty is LOTS. Notional multiplier for PnL = contracts * contractValue
function notionalMultiplier(cfg: any, runtime: any): number | null {
  const lots = toNum(cfg?.quantity);
  if (lots === null || lots <= 0) return null;
  const lotSize = toNum(runtime?.lotSize ?? cfg?.lotSize) ?? 1;
  const cv = toNum(runtime?.contractValue ?? cfg?.contractValue) ?? 1;
  const contracts = Math.floor(lots) * Math.floor(lotSize > 0 ? lotSize : 1);
  const mult = contracts * (cv > 0 ? cv : 1);
  return Number.isFinite(mult) && mult > 0 ? mult : null;
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

    let totalInitial = 0;
    let totalCurrent = 0;
    let totalPnl = 0;
    let totalsOk = 0;

    const lines: string[] = [];
    lines.push(`<b>9BOT</b> — Summary`);
    lines.push(`<b>Total bots:</b> ${bots.length} · <b>Running:</b> ${running.length}`);
    lines.push(`<b>Time:</b> ${new Date(now).toISOString()}`);
    lines.push('');

    const show = bots.slice(0, 25); // prevent huge telegram messages
    for (const b of show) {
      const exec = (((b.config as any)?.execution || 'paper') as 'paper' | 'live');
      const ex = ((b.config as any)?.exchange || 'delta_india') as 'delta_india' | 'delta_global';
      const exLabel = ex === 'delta_global' ? 'DG' : 'DI';
      const sym = String(b.config.symbol || '—').toUpperCase();
      const startP = toNum((b as any).runtime?.startedPrice);
      const curP = toNum((b as any).runtime?.lastPrice);
      const mult = notionalMultiplier(b.config, (b as any).runtime);

      let pnlStr = '—';
      let initStr = '—';

      if (mult !== null && mult > 0 && startP !== null && startP > 0 && curP !== null && curP > 0) {
        const initial = mult * startP;
        const currentVal = mult * curP;
        const pnl = (b.config.mode as any) === 'short' ? initial - currentVal : currentVal - initial;
        const pct = initial > 0 ? (pnl / initial) * 100 : null;
        initStr = `$${initial.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
        pnlStr = pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% ($${pnl.toLocaleString(undefined, { maximumFractionDigits: 8 })})`;

        totalInitial += initial;
        totalCurrent += currentVal;
        totalPnl += pnl;
        totalsOk += 1;
      }

      lines.push(
        [
          `<b>${sym}</b> · ${exLabel} · ${exec.toUpperCase()} · ${b.isRunning ? 'RUNNING' : 'STOPPED'}`,
          `Init: ${initStr} · PnL: ${pnlStr}`,
          `Start: ${startP === null ? '—' : formatPrice(startP)} · Now: ${curP === null ? '—' : formatPrice(curP)}`,
        ].join('\n')
      );
      lines.push('');
    }

    if (bots.length > show.length) {
      lines.push(`<i>+ ${bots.length - show.length} more bots not shown</i>`);
    }

    if (totalsOk > 0) {
      const pct = totalInitial > 0 ? (totalPnl / totalInitial) * 100 : null;
      lines.unshift(
        `<b>Total notional:</b> Init $${totalInitial.toLocaleString(undefined, { maximumFractionDigits: 8 })} · ` +
          `Now $${totalCurrent.toLocaleString(undefined, { maximumFractionDigits: 8 })} · ` +
          `PnL ${pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`} ($${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 8 })})`
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






