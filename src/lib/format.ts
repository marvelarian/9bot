export function formatPrice(value: number | null | undefined, maxDecimals = 8): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  // NOTE: Intl.NumberFormat rounds at maxDecimals (as expected for display).
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: 0,
  }).format(value);
}

/**
 * Convert USD to INR (1 USD = 85 INR)
 */
export function usdToInr(usdValue: number): number {
  return usdValue * 85;
}

/**
 * Convert PNL value from USD to INR for display
 */
export function convertPnlToInr(pnlValue: number | null | undefined): number | undefined {
  if (pnlValue === null || pnlValue === undefined || !Number.isFinite(pnlValue)) {
    return undefined;
  }
  return usdToInr(pnlValue);
}









