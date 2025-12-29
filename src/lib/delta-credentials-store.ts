import { promises as fs } from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/server/file-store';

export type StoredDeltaCredentials = {
  baseUrl?: string; // e.g. https://api.delta.exchange or India domain
  apiKey: string;
  apiSecret: string;
  updatedAt: number;
};

const FILE_PATH = resolveDataPath('delta-credentials.json');

export type DeltaExchangeId = 'delta_india' | 'delta_global';

type StoredDeltaCredentialsFileV2 = {
  version: 2;
  active?: DeltaExchangeId;
  profiles: Partial<Record<DeltaExchangeId, StoredDeltaCredentials>>;
};

function inferExchangeIdFromBaseUrl(baseUrl?: string): DeltaExchangeId {
  const u = (baseUrl || '').toLowerCase();
  if (u.includes('india.delta.exchange')) return 'delta_india';
  return 'delta_global';
}

function isV2(x: any): x is StoredDeltaCredentialsFileV2 {
  return x && typeof x === 'object' && x.version === 2 && x.profiles && typeof x.profiles === 'object';
}

function isCred(x: any): x is StoredDeltaCredentials {
  return x && typeof x === 'object' && typeof x.apiKey === 'string' && typeof x.apiSecret === 'string';
}

export async function readDeltaCredentials(exchange?: DeltaExchangeId): Promise<StoredDeltaCredentials | null> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as any;

    // v2 format: multiple profiles
    if (isV2(parsed)) {
      const active = exchange || parsed.active;
      const pick = active ? parsed.profiles?.[active] : null;
      if (pick && isCred(pick)) return pick;
      // fallback: first valid profile
      for (const k of Object.keys(parsed.profiles || {}) as DeltaExchangeId[]) {
        const c = (parsed.profiles as any)[k];
        if (isCred(c)) return c;
      }
      return null;
    }

    // v1 format: single profile, migrate mentally by treating it as default
    if (isCred(parsed)) {
      return parsed as StoredDeltaCredentials;
    }

    return null;
  } catch {
    return null;
  }
}

export async function readAllDeltaCredentials(): Promise<StoredDeltaCredentialsFileV2 | null> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as any;
    if (isV2(parsed)) return parsed;
    if (isCred(parsed)) {
      const ex = inferExchangeIdFromBaseUrl(parsed.baseUrl);
      return { version: 2, active: ex, profiles: { [ex]: parsed } } as StoredDeltaCredentialsFileV2;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeDeltaCredentials(input: {
  exchange?: DeltaExchangeId;
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}): Promise<StoredDeltaCredentials> {
  const safeBaseUrl = input.baseUrl?.trim() || undefined;
  const data: StoredDeltaCredentials = {
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    baseUrl: safeBaseUrl,
    updatedAt: Date.now(),
  };

  const existing = await readAllDeltaCredentials();
  const exchange = input.exchange || inferExchangeIdFromBaseUrl(safeBaseUrl);
  const v2: StoredDeltaCredentialsFileV2 = existing && isV2(existing) ? existing : { version: 2, profiles: {} };
  v2.profiles = { ...(v2.profiles || {}), [exchange]: data };
  v2.active = exchange;

  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(v2, null, 2), 'utf8');
  return data;
}

export async function setActiveDeltaExchange(exchange: DeltaExchangeId): Promise<void> {
  const existing = await readAllDeltaCredentials();
  const v2: StoredDeltaCredentialsFileV2 = existing && isV2(existing) ? existing : { version: 2, profiles: {} };
  v2.active = exchange;
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(v2, null, 2), 'utf8');
}

export async function clearDeltaCredentials(exchange?: DeltaExchangeId): Promise<void> {
  try {
    if (!exchange) {
      await fs.unlink(FILE_PATH);
      return;
    }
    const existing = await readAllDeltaCredentials();
    if (!existing || !isV2(existing)) return;
    const next: StoredDeltaCredentialsFileV2 = {
      version: 2,
      active: existing.active,
      profiles: { ...(existing.profiles || {}) },
    };
    delete (next.profiles as any)[exchange];
    if (next.active === exchange) {
      const keys = Object.keys(next.profiles || {}) as DeltaExchangeId[];
      next.active = keys[0];
    }
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // ignore
  }
}




