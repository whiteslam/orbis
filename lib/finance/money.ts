export function money(amount: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: compact || amount >= 1000 ? 0 : 2, notation: compact ? 'compact' : 'standard' }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
}
