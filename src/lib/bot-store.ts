import type { GridBotConfig } from '@/lib/types';
import type { ActivityEvent, BotRecord } from '@/lib/bots/types';

export type { ActivityEvent, BotRecord };

type BotsPayload = { bots: BotRecord[] };
type ActivityPayload = { activity: ActivityEvent[] };

let botsCache: BotRecord[] = [];
let activityCache: ActivityEvent[] = [];

function notifyBotsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('bots:changed'));
}
function notifyActivityChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('activity:changed'));
}

export function getBots(): BotRecord[] {
  return botsCache;
}

export function getActivity(): ActivityEvent[] {
  return activityCache;
}

export async function refreshBots(): Promise<BotRecord[]> {
  const res = await fetch('/api/bots', { cache: 'no-store' });
  const json = (await res.json()) as any;
  if (!json?.ok) throw new Error(json?.error || 'bots fetch failed');
  botsCache = Array.isArray((json as BotsPayload).bots) ? (json as BotsPayload).bots : [];
  notifyBotsChanged();
  return botsCache;
}

export async function refreshActivity(): Promise<ActivityEvent[]> {
  const res = await fetch('/api/activity', { cache: 'no-store' });
  const json = (await res.json()) as any;
  if (!json?.ok) throw new Error(json?.error || 'activity fetch failed');
  activityCache = Array.isArray((json as ActivityPayload).activity) ? (json as ActivityPayload).activity : [];
  notifyActivityChanged();
  return activityCache;
}

export async function createBot(config: GridBotConfig, name?: string): Promise<BotRecord> {
  const res = await fetch('/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config, name }),
  });
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || 'create bot failed');
  const bot = json.bot as BotRecord;
  // optimistic cache update
  botsCache = [bot, ...botsCache.filter((b) => b.id !== bot.id)];
  notifyBotsChanged();
  void refreshActivity().catch(() => null);
  return bot;
}

export async function updateBot(id: string, patch: Partial<Omit<BotRecord, 'id' | 'createdAt'>>): Promise<BotRecord | null> {
  const res = await fetch(`/api/bots/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch }),
  });
  const json = await res.json();
  if (!json?.ok) return null;
  const bot = (json.bot || null) as BotRecord | null;
  if (bot) {
    botsCache = botsCache.map((b) => (b.id === bot.id ? bot : b));
  }
  notifyBotsChanged();
  void refreshActivity().catch(() => null);
  return bot;
}

export async function deleteBot(id: string): Promise<void> {
  const res = await fetch(`/api/bots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const json = await res.json().catch(() => ({}));
  if (!(json as any)?.ok) throw new Error((json as any)?.error || 'delete failed');
  botsCache = botsCache.filter((b) => b.id !== id);
  notifyBotsChanged();
  void refreshActivity().catch(() => null);
}

export async function stopBotsByExchange(exchange?: 'delta_india' | 'delta_global'): Promise<void> {
  const res = await fetch('/api/bots/emergency-stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exchange }),
  });
  const json = await res.json().catch(() => ({}));
  if (!(json as any)?.ok) throw new Error((json as any)?.error || 'emergency stop failed');
  await refreshBots();
  void refreshActivity().catch(() => null);
}

export async function stopAllBots(): Promise<void> {
  return stopBotsByExchange(undefined);
}



