export type EquitySnapshot = {
  value: number;
  label: string; // INR / USDC / USD / etc
};

function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function fetchEquitySnapshot(exchange?: 'delta_india' | 'delta_global'): Promise<EquitySnapshot> {
  // Client-side helper: compute best-effort equity using wallet (+ unrealized pnl in INR if present).
  const qs = exchange ? `?exchange=${encodeURIComponent(exchange)}` : '';
  const [wRes, pRes] = await Promise.all([
    fetch(`/api/delta/wallet${qs}`, { cache: 'no-store' }).then((r) => r.json()),
    fetch(`/api/delta/positions${qs}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ ok: false })),
  ]);

  if (!wRes?.ok) throw new Error(wRes?.error || 'wallet failed');
  const wallet = Array.isArray(wRes.result) ? wRes.result : [];
  const positions = pRes?.ok && Array.isArray(pRes.result) ? pRes.result : [];

  // Prefer INR if *_inr is provided (Delta India often provides this).
  let inr = 0;
  let hasInr = false;
  for (const row of wallet as any[]) {
    const bi = toNum(row?.balance_inr);
    if (bi !== null) {
      inr += bi;
      hasInr = true;
    }
  }
  if (hasInr) {
    for (const p of positions as any[]) {
      const up = toNum(p?.unrealized_pnl_inr);
      if (up !== null) inr += up;
    }
    return { value: inr, label: 'INR' };
  }

  // Fallback: sum settlement currency balance (USDC -> USD -> INR)
  const by: Record<string, number> = {};
  for (const row of wallet as any[]) {
    const sym = String(row?.asset_symbol || '');
    const bal = toNum(row?.balance);
    if (!sym || bal === null) continue;
    by[sym] = (by[sym] || 0) + bal;
  }
  const sym = by.USDC ? 'USDC' : by.USD ? 'USD' : by.INR ? 'INR' : '—';
  return { value: sym === '—' ? 0 : by[sym], label: sym };
}


