// What the Finance tab leads with: the answer to "where did the money go",
// unless something is broken first.

import type { FinanceSummary } from '@/lib/finance/types';
import type { Focus, QuietRow } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count, istParts, money, percent } from './types.ts';

function monthTotals(summary: FinanceSummary, now: Date) {
  const month = summary.month;
  if (!month) return null;
  const today = istParts(now);
  const isThisMonth = month.year === today.year && month.month === today.month;
  const days = isThisMonth ? Math.max(today.day, 1) : new Date(month.year, month.month, 0).getDate();
  const top = month.categories.slice().sort((left, right) => right.amount - left.amount)[0] ?? null;
  return { month, days, top, isThisMonth };
}

export function composeFinanceFocus({ summary, now = new Date() }: { summary: FinanceSummary; now?: Date }): Focus {
  if (!summary.databaseReady) {
    return {
      id: 'finance-setup',
      headline: 'Finance isn’t available right now.',
      body: 'Nothing you enter elsewhere in Orbis is affected. Try again later.',
      action: null,
    };
  }
  if (summary.loadError) {
    return {
      id: 'finance-unavailable',
      headline: 'Your finance data could not be loaded.',
      body: 'The rest of Orbis is unaffected, but everything on this screen is stale until the next successful load. Refreshing the app tries again.',
      action: null,
    };
  }
  const totals = monthTotals(summary, now);
  if (totals && totals.month.spent > 0) {
    const { month, days, top } = totals;
    const perDay = month.spent / days;
    const share = top && month.spent > 0 ? percent(top.amount / month.spent) : null;
    return {
      id: 'month-so-far',
      headline: `${money(month.spent, month.currency)} spent${totals.isThisMonth ? ' so far' : ''}.`,
      body: `About ${money(perDay, month.currency)} a day, ${count(days, 'day')} in.${top && share ? ` ${top.category} is the largest share at ${share}.` : ''}${month.received > 0 ? ` ${money(month.received, month.currency)} came in over the same period.` : ''}`,
      action: null,
    };
  }

  return {
    id: 'quiet-month',
    headline: 'Nothing has been logged yet this month.',
    body: 'Adding an expense by hand takes a few seconds, and the month fills in from there.',
    action: null,
  };
}

export function composeFinanceRows({ summary, now = new Date() }: { summary: FinanceSummary; now?: Date }): QuietRow[] {
  const totals = monthTotals(summary, now);
  const month = totals?.month;
  const top = totals?.top ?? null;
  const expenses = summary.monthlyExpenses.length === 1
    ? money(summary.monthlyExpenses[0].amount, summary.monthlyExpenses[0].currency)
    : summary.monthlyExpenses.length > 1
      ? 'Several currencies'
      : 'No data';

  return [
    { label: 'Spent this month', value: expenses, empty: summary.monthlyExpenses.length === 0, target: null },
    { label: 'Daily average', value: month && month.spent > 0 && totals ? money(month.spent / totals.days, month.currency) : 'No data', empty: !month || month.spent === 0, target: null },
    { label: 'Largest category', value: top ? `${top.category} · ${money(top.amount, month?.currency ?? 'INR')}` : 'No data', empty: !top, target: null },
    { label: 'Received this month', value: month && month.received > 0 ? money(month.received, month.currency) : 'None', empty: !month || month.received === 0, target: null },
    { label: 'Saved transactions', value: summary.transactions.length ? count(summary.transactions.length, 'transaction') : 'None yet', empty: summary.transactions.length === 0, target: null },
  ];
}
