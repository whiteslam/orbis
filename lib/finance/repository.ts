import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { FinanceSummary, OwnInvestments } from '@/lib/finance/types';
import { INVESTMENT_CATEGORIES, isInvestmentCategory } from '@/lib/finance/manual';
import { monthBreakdown, summariseOwnInvestments } from '@/lib/finance/breakdown';
import { isMissingTable } from '@/lib/supabase/errors';

const emptySummary: FinanceSummary = {
  databaseReady: true,
  loadError: false,
  transactions: [],
  monthlyExpenses: [],
  incomePlan: [],
  incomePlanReady: false,
  ownInvestments: { currency: 'INR', total: 0, categories: [] },
  month: null,
};

/**
 * What the user expects to earn. Missing until the income plan migration is
 * applied, which the screen reports rather than failing over.
 */
async function loadIncomePlan(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data, error } = await supabase
    .from('income_plan')
    .select('id,label,amount,currency,pay_day,category,active')
    .eq('user_id', userId)
    .order('amount', { ascending: false })
    .limit(10);
  if (error) return { ready: false, entries: [] as FinanceSummary['incomePlan'] };
  return {
    ready: true,
    entries: (data ?? []).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      amount: Number(row.amount),
      currency: String(row.currency),
      payDay: Number(row.pay_day),
      category: String(row.category),
      active: row.active !== false,
    })),
  };
}

/**
 * Every investment entry ever recorded, summed by category. One currency, the
 * one most was invested in, like the month breakdown.
 */
export async function loadOwnInvestments(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<OwnInvestments> {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, currency, category, occurred_at')
    .eq('user_id', userId)
    .eq('direction', 'expense')
    .in('category', [...INVESTMENT_CATEGORIES])
    .order('occurred_at', { ascending: false })
    .limit(2000);
  if (error || !data) return emptySummary.ownInvestments;
  return summariseOwnInvestments(data.map((row) => ({ ...row, amount: Number(row.amount) })));
}

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

  const [transactionsResult, expensesResult, plan, ownInvestments] = await Promise.all([
    loadRecentTransactions(supabase, userId),
    supabase
      .from('transactions')
      .select('amount, currency, direction, category, occurred_at')
      .eq('user_id', userId)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', now.toISOString()),
    loadIncomePlan(supabase, userId),
    loadOwnInvestments(supabase, userId),
  ]);

  if (transactionsResult.error || expensesResult.error) {
    const error = transactionsResult.error ?? expensesResult.error;
    const missing = !error || isMissingTable(error);
    return { ...emptySummary, databaseReady: !missing, loadError: Boolean(error) && !missing };
  }

  const monthRows = (expensesResult.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
  const totals = new Map<string, number>();
  for (const transaction of monthRows) {
    if (transaction.direction === 'expense' && !isInvestmentCategory(transaction.category)) totals.set(transaction.currency, (totals.get(transaction.currency) ?? 0) + transaction.amount);
  }

  return {
    databaseReady: true,
    loadError: false,
    incomePlan: plan.entries,
    incomePlanReady: plan.ready,
    ownInvestments,
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
