// Pure month and investment arithmetic, kept apart from the database code so it can be tested.

import type { FinanceSummary, OwnInvestments } from '@/lib/finance/types';
import { isInvestmentCategory } from '@/lib/finance/manual';

export function summariseOwnInvestments(rows: Array<{ amount: number; currency: string; category: string | null; occurred_at: string }>): OwnInvestments {
  const byCurrency = new Map<string, number>();
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
  const currency = [...byCurrency].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
  const categories = new Map<string, { category: string; amount: number; count: number; lastAt: string }>();
  for (const row of rows) {
    if (row.currency !== currency || !isInvestmentCategory(row.category)) continue;
    const entry = categories.get(row.category!) ?? { category: row.category!, amount: 0, count: 0, lastAt: row.occurred_at };
    entry.amount += row.amount;
    entry.count += 1;
    if (row.occurred_at > entry.lastAt) entry.lastAt = row.occurred_at;
    categories.set(row.category!, entry);
  }
  const list = [...categories.values()].sort((a, b) => b.amount - a.amount);
  return { currency, total: list.reduce((sum, entry) => sum + entry.amount, 0), categories: list };
}

// Charts show one currency: whichever had the most spending this month (INR when there is none).
export function monthBreakdown(rows: Array<{ amount: number; currency: string; direction: string; category: string | null; occurred_at: string }>, totals: Map<string, number>, year: number, month: number): FinanceSummary['month'] {
  const currency = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? rows[0]?.currency ?? 'INR';
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daily = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, amount: 0 }));
  const categories = new Map<string, number>();
  // Income carried a category all along and nothing ever read it, so "where did
  // the money come from" had an answer stored and no way to see it.
  const incomeCategories = new Map<string, number>();
  let spent = 0;
  let received = 0;
  let invested = 0;
  for (const row of rows) {
    if (row.currency !== currency) continue;
    if (row.direction === 'income') {
      received += row.amount;
      const source = row.category || 'Other';
      incomeCategories.set(source, (incomeCategories.get(source) ?? 0) + row.amount);
      continue;
    }
    if (isInvestmentCategory(row.category)) {
      invested += row.amount;
      continue;
    }
    spent += row.amount;
    const category = row.category || 'Other';
    categories.set(category, (categories.get(category) ?? 0) + row.amount);
    const day = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date(row.occurred_at)));
    if (daily[day - 1]) daily[day - 1].amount += row.amount;
  }
  return {
    currency,
    year,
    month,
    spent,
    received,
    invested,
    categories: [...categories].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    incomeCategories: [...incomeCategories].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    daily,
  };
}
