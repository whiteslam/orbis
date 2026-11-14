// How a waiting phone payment reads in the review list. Pure and client-safe, so
// the component and the tests share it (phone-review.ts is server-only).

import { formatMoney } from '@/lib/locale/money';

import type { PhoneTransaction } from '@/lib/finance/phone-review';

/** A waiting payment as the browser sees it: everything but the notification's own text. */
export type PhoneTransactionView = Omit<PhoneTransaction, 'text'>;

/** Drops the notification text, keeping only the fields the review list shows. */
export function toPhoneTransactionView(t: PhoneTransaction): PhoneTransactionView {
  return { signalId: t.signalId, amount: t.amount, currency: t.currency, direction: t.direction, merchant: t.merchant, occurredAt: t.occurredAt };
}

type ReviewLineInput = Pick<PhoneTransactionView, 'amount' | 'currency' | 'direction' | 'merchant' | 'occurredAt'>;

/**
 * A payment's title ("Swiggy, ₹1,250") and meta ("Spent, 14 Nov"). The payment's own
 * currency wins; `currency` (the person's) only stands in if it has none. The day is
 * in the person's `timeZone`. The notification's text is never part of it.
 */
export function reviewLine(t: ReviewLineInput, locale: string, currency: string, timeZone = 'UTC'): { title: string; meta: string } {
  const amount = formatMoney(t.amount, t.currency || currency, locale, { decimals: 'exact' });
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
