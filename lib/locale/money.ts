// Money formatting in the person's own currency and language. Pure and client-safe.

/**
 * `decimals: 'auto'` (default) shows no decimals when compact or at 1000 and over, otherwise two.
 * `decimals: 0` always shows whole units. An unknown currency falls back to "CODE amount".
 */
export function formatMoney(amount: number, currency: string, locale: string, opts: { compact?: boolean; decimals?: 'auto' | 0 } = {}): string {
  const compact = opts.compact ?? false;
  const whole = compact || opts.decimals === 0 || amount >= 1000;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: whole ? 0 : 2,
      notation: compact ? 'compact' : 'standard',
    }).format(amount);
  } catch {
    try {
      return `${currency} ${amount.toLocaleString(locale)}`;
    } catch {
      return `${currency} ${amount}`;
    }
  }
}
