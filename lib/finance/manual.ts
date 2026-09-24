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
