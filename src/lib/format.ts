export function formatPrice(value: number | null | undefined, maxDecimals = 8): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  // NOTE: Intl.NumberFormat rounds at maxDecimals (as expected for display).
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: 0,
  }).format(value);
}









