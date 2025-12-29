import { readTelegramConfig } from '@/lib/telegram-config-store';

export async function sendTelegramText(text: string, chatIdOverride?: string): Promise<void> {
  const stored = await readTelegramConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN || stored?.botToken;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID || stored?.chatId;
  if (!token || !chatId) throw new Error('Telegram not configured');

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    const msg = (json as any)?.description || `${res.status} ${res.statusText}`;
    throw new Error(`Telegram send failed: ${msg}`);
  }
}









