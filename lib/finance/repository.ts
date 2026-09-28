import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { FinanceSummary } from '@/lib/finance/types';
import { isMissingTable } from '@/lib/supabase/errors';

const emptySummary: FinanceSummary = {
  databaseReady: true,
  loadError: false,
  transactions: [],
  monthlyExpenses: [],
  month: null,
};

const transactionColumns = 'id, amount, currency, direction, merchant, category, occurred_at, source';

// payment_method and note arrive with the manual-transactions migration; keep
// listing transactions if it has not been applied yet.
async function loadRecentTransactions(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const detailed = await supabase
    .from('transactions')
    .select(`${transactionColumns}, payment_method, note`)
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(20);
  if (detailed.error?.code !== '42703') return detailed;

  const basic = await supabase
    .from('transactions')
    .select(transactionColumns)
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(20);
  return {
    ...basic,
    data: basic.data?.map((transaction) => ({ ...transaction, payment_method: null as string | null, note: null as string | null })) ?? null,
  };
}

export async function getFinanceSummary(userId: string): Promise<FinanceSummary> {
  const supabase = await createClient();

  const now = new Date();
  const monthParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(monthParts.find((part) => part.type === 'year')?.value);
  const month = Number(monthParts.find((part) => part.type === 'month')?.value);
  const start = new Date(Date.UTC(year, month - 1, 1) - 330 * 60 * 1000);

  const [transactionsResult, expensesResult] = await Promise.all([
    loadRecentTransactions(supabase, userId),
    supabase
      .from('transactions')
      .select('amount, currency, direction, category, occurred_at')
      .eq('user_id', userId)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', now.toISOString()),
  ]);

  if (transactionsResult.error || expensesResult.error) {
    const error = transactionsResult.error ?? expensesResult.error;
    const missing = !error || isMissingTable(error);
    return { ...emptySummary, databaseReady: !missing, loadError: Boolean(error) && !missing };
  }

  const monthRows = (expensesResult.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
  const totals = new Map<string, number>();
  for (const transaction of monthRows) {
    if (transaction.direction === 'expense') totals.set(transaction.currency, (totals.get(transaction.currency) ?? 0) + transaction.amount);
  }

  return {
    databaseReady: true,
    loadError: false,
    transactions: (transactionsResult.data ?? []).map((transaction) => ({
      id: transaction.id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      direction: transaction.direction,
      merchant: transaction.merchant,
      category: transaction.category,
      occurredAt: transaction.occurred_at,
      source: transaction.source,
      paymentMethod: transaction.payment_method,
      note: transaction.note,
    })),
    monthlyExpenses: Array.from(totals, ([currency, amount]) => ({ currency, amount })),
    month: monthBreakdown(monthRows, totals, year, month),
  };
}

// Charts show one currency: whichever had the most spending this month (INR when there is none).
function monthBreakdown(rows: Array<{ amount: number; currency: string; direction: string; category: string | null; occurred_at: string }>, totals: Map<string, number>, year: number, month: number): FinanceSummary['month'] {
  const currency = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? rows[0]?.currency ?? 'INR';
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daily = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, amount: 0 }));
  const categories = new Map<string, number>();
  let spent = 0;
  let received = 0;
  for (const row of rows) {
    if (row.currency !== currency) continue;
    if (row.direction === 'income') {
      received += row.amount;
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
    categories: [...categories].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    daily,
  };
}
