export const runtime = 'nodejs';

import { readTelegramConfig } from '@/lib/telegram-config-store';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get('limit') || '5')));

    const stored = await readTelegramConfig();
    const token = process.env.TELEGRAM_BOT_TOKEN || stored?.botToken;
    if (!token) throw new Error('Missing Telegram bot token. Configure it first.');

    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=${limit}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      const msg = json?.description || `${res.status} ${res.statusText}`;
      return Response.json({ ok: false, error: `Telegram getUpdates failed: ${msg}` }, { status: 500 });
    }

    return Response.json({ ok: true, result: json?.result || [] });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}


