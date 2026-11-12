import { formatMoney } from '@/lib/locale/money';

export function money(amount: number, currency: string, compact = false) {
  return formatMoney(amount, currency, 'en-IN', { compact });
}
