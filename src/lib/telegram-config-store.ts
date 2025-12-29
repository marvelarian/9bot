import { promises as fs } from 'fs';
import path from 'path';

export type TelegramConfig = {
  botToken: string;
  chatId: string;
  updatedAt: number;
};

const FILE_PATH = path.join(process.cwd(), 'data', 'telegram-config.json');

function safeParse(raw: string): TelegramConfig | null {
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed?.botToken || !parsed?.chatId) return null;
    return {
      botToken: String(parsed.botToken),
      chatId: String(parsed.chatId),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function readTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    return safeParse(raw);
  } catch {
    return null;
  }
}

export async function writeTelegramConfig(input: { botToken: string; chatId: string }): Promise<TelegramConfig> {
  const data: TelegramConfig = {
    botToken: input.botToken.trim(),
    chatId: input.chatId.trim(),
    updatedAt: Date.now(),
  };
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export async function clearTelegramConfig(): Promise<void> {
  try {
    await fs.unlink(FILE_PATH);
  } catch {
    // ignore
  }
}









