import type { DeltaProductMeta } from '@/lib/delta-products';

function decimalsFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  // Convert to string safely; Delta often returns decimal strings, but at this point step is a number.
  const s = String(step);
  const idx = s.indexOf('.');
  if (idx === -1) return 0;
  return Math.min(18, s.length - idx - 1);
}

function roundDownToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const q = Math.floor((value + 1e-12) / step);
  const out = q * step;
  const dp = decimalsFromStep(step);
  return dp > 0 ? Number(out.toFixed(dp)) : out;
}

export function normalizeDeltaOrderSize(params: {
  requestedSize: number;
  product: DeltaProductMeta;
}): { size: number; min: number; step: number; adjusted: boolean } {
  const requested = Number(params.requestedSize);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error(`Invalid order size: ${params.requestedSize}`);
  }

  // Delta's public product payload doesn't expose an explicit "size_step".
  // In practice sizes are typically integer contract counts. We'll enforce integer step=1.
  // If Delta later exposes an explicit step, we can wire it here.
  const step = 1;
  const min = Number.isFinite(Number(params.product.minOrderSize)) ? Math.max(1, Number(params.product.minOrderSize)) : 1;

  const snapped = roundDownToStep(requested, step);
  if (!Number.isFinite(snapped) || snapped <= 0) {
    throw new Error(`Order size too small after step rounding (step=${step})`);
  }
  if (snapped < min) {
    throw new Error(`Order size ${snapped} is below min size ${min} for ${params.product.symbol}`);
  }

  return { size: snapped, min, step, adjusted: snapped !== requested };
}




