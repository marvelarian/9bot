export const runtime = 'nodejs';

type Body = {
  chatId?: string;
  text: string;
};

import { readTelegramConfig } from '@/lib/telegram-config-store';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.text) {
      return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
    }

    const stored = await readTelegramConfig();
    const token = process.env.TELEGRAM_BOT_TOKEN || stored?.botToken;
    const defaultChatId = process.env.TELEGRAM_CHAT_ID || stored?.chatId;
    if (!token) throw new Error('Missing Telegram bot token. Configure in API Integration or set TELEGRAM_BOT_TOKEN.');

    const chatId = body.chatId || defaultChatId;
    if (!chatId) {
      return Response.json({ ok: false, error: 'No chatId. Provide chatId or configure TELEGRAM_CHAT_ID.' }, { status: 400 });
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: body.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      const msg = json?.description || `${res.status} ${res.statusText}`;
      return Response.json({ ok: false, error: `Telegram send failed: ${msg}` }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}



