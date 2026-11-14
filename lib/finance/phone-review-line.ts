// How a waiting phone payment reads in the review list. Pure and client-safe, so
// the component and the tests share it (phone-review.ts is server-only).

import { formatMoney } from '@/lib/locale/money';

type ReviewLineInput = { amount: number; currency: string; direction: 'expense' | 'income'; merchant: string | null; occurredAt: string };

/**
 * A payment's title ("Swiggy, ₹1,250") and meta ("Spent, 14 Nov"). The payment's own
 * currency wins; `currency` (the person's) only stands in if it has none. The day is
 * in the person's `timeZone`. The notification's text is never part of it.
 */
export function reviewLine(t: ReviewLineInput, locale: string, currency: string, timeZone = 'UTC'): { title: string; meta: string } {
  const amount = formatMoney(t.amount, t.currency || currency, locale);
  let day: string;
  try {
    day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(t.occurredAt));
  } catch {
    day = new Date(t.occurredAt).toISOString().slice(0, 10);
  }
  return {
    title: `${t.merchant ?? 'Payment'}, ${amount}`,
    meta: `${t.direction === 'expense' ? 'Spent' : 'Received'}, ${day}`,
  };
}
