export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { createBotForUser, listBots, listBotsIncludingDeleted } from '@/lib/server/bots-store';

export async function GET(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const { searchParams } = new URL(req.url);
    const includeDeleted = searchParams.get('includeDeleted') === '1';
    const bots = includeDeleted ? await listBotsIncludingDeleted(email) : await listBots(email);
    return NextResponse.json({ ok: true, bots });
  } catch (e: any) {
    const msg = e?.message || 'bots failed';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: Request) {
  try {
    const email = await requireAuthedEmail();
    const body = await req.json().catch(() => ({}));
    const config = body?.config;
    const name = body?.name;
    if (!config) return NextResponse.json({ ok: false, error: 'config is required' }, { status: 400 });
    const bot = await createBotForUser(email, config, name);
    return NextResponse.json({ ok: true, bot });
  } catch (e: any) {
    const msg = e?.message || 'create bot failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






