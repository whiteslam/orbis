// Shared by the manual entry form and its server action, so keep this file client-safe.

export const EXPENSE_CATEGORIES = [
  'Food & dining',
  'Groceries',
  'Transport',
  'Fuel',
  'Shopping',
  'Bills & utilities',
  'Rent & housing',
  'Health',
  'Fitness',
  'Entertainment',
  'Travel',
  'Education',
  'Subscriptions',
  'Personal care',
  'Gifts & donations',
  'EMI & loans',
  'Other',
] as const;

export const INCOME_CATEGORIES = [
  'Salary',
  'Business',
  'Freelance',
  'Interest & dividends',
  'Refund',
  'Gift',
  'Other',
] as const;

/**
 * Money moved into an investment. Stored as an expense row (it did leave the
 * account) but kept out of "spent": it is saved, not gone, and it is listed
 * again under Investments as an entry of your own.
 */
export const INVESTMENT_CATEGORIES = [
  'SIP / Mutual fund',
  'Stocks',
  'FD',
  'RD',
  'PPF / EPF',
  'NPS',
  'Gold',
  'Other investment',
] as const;

export function isInvestmentCategory(category: string | null | undefined) {
  return Boolean(category) && (INVESTMENT_CATEGORIES as readonly string[]).includes(category as string);
}

export const PAYMENT_METHODS = [
  ['upi', 'UPI'],
  ['debit_card', 'Debit card'],
  ['credit_card', 'Credit card'],
  ['cash', 'Cash'],
  ['net_banking', 'Net banking'],
  ['wallet', 'Wallet'],
  ['other', 'Other'],
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number][0];

export const MANUAL_NOTE_MAX_LENGTH = 500;

export function paymentMethodLabel(value: string | null) {
  return PAYMENT_METHODS.find(([key]) => key === value)?.[1] ?? null;
}
