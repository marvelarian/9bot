export const runtime = 'nodejs';

import { clearTelegramConfig, readTelegramConfig, writeTelegramConfig } from '@/lib/telegram-config-store';

function maskToken(t: string) {
  if (!t) return '—';
  if (t.length <= 10) return '********';
  return `${t.slice(0, 6)}****${t.slice(-4)}`;
}

export async function GET() {
  const fromEnv = !!process.env.TELEGRAM_BOT_TOKEN;
  const stored = await readTelegramConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN || stored?.botToken || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || stored?.chatId || '';

  return Response.json({
    ok: true,
    configured: !!(token && chatId),
    source: process.env.TELEGRAM_BOT_TOKEN ? 'env' : stored ? 'store' : 'none',
    botTokenMasked: token ? maskToken(token) : null,
    chatId: chatId || null,
    updatedAt: stored?.updatedAt || null,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { botToken?: string; chatId?: string };
    const botToken = body?.botToken?.trim();
    const chatId = body?.chatId?.trim();
    if (!botToken || !chatId) {
      return Response.json({ ok: false, error: 'botToken and chatId are required' }, { status: 400 });
    }

    // Telegram accepts:
    // - numeric chat_id (private/group): 123..., -100...
    // - @channelusername for channels
    // Bot username (like "MyBot") is NOT a chat_id.
    const isNumeric = /^-?\d+$/.test(chatId);
    const isAtName = /^@[A-Za-z0-9_]{5,}$/.test(chatId);
    if (!isNumeric && !isAtName) {
      return Response.json(
        { ok: false, error: 'chatId must be a numeric chat id (e.g. 123456789 / -100...) or @channelusername. Do not use the bot username.' },
        { status: 400 }
      );
    }
    const saved = await writeTelegramConfig({ botToken, chatId });
    return Response.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}

export async function DELETE() {
  await clearTelegramConfig();
  return Response.json({ ok: true });
}


