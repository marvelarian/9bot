export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireAuthedEmail } from '@/lib/server/auth';
import { deleteBotForUser, patchBotForUser } from '@/lib/server/bots-store';

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const email = await requireAuthedEmail();
    const id = String(ctx?.params?.id || '');
    const body = await req.json().catch(() => ({}));
    const patch = body?.patch || {};

    const bot = await patchBotForUser(email, id, patch);
    if (!bot) return NextResponse.json({ ok: false, error: 'conflict_or_not_found' }, { status: 409 });
    return NextResponse.json({ ok: true, bot });
  } catch (e: any) {
    const msg = e?.message || 'update failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const email = await requireAuthedEmail();
    const id = String(ctx?.params?.id || '');
    await deleteBotForUser(email, id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || 'delete failed';
    const code = msg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}






