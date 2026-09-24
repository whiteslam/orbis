// What the Finance tab leads with: the answer to "where did the money go",
// unless something is broken or waiting on a decision first.

import type { FinanceSummary } from '@/lib/finance/types';
import type { Focus, QuietRow } from '@/lib/focus/types';
import { count, istParts, money, percent } from '@/lib/focus/types';

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
      headline: 'Finance is waiting on a database migration.',
      body: 'Apply the finance, Gmail, workbook-usage and transaction-review migrations in Supabase and this screen starts working. Nothing you enter elsewhere in Orbis is affected.',
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
  if (summary.connection?.status === 'reconnect_required') {
    return {
      id: 'gmail-reconnect',
      headline: 'Gmail stopped talking to Orbis.',
      body: `Google expired the connection for ${summary.connection.email}, so no new bank alerts are arriving. Reconnect below; everything already saved stays exactly as it is.`,
      action: null,
    };
  }
  if (summary.pendingCandidateCount > 0) {
    const alerts = summary.pendingCandidateCount;
    const unreadable = summary.unparsedCandidateCount;
    return {
      id: 'review-alerts',
      headline: alerts === 1 ? 'One alert is waiting to be confirmed.' : `${alerts} alerts are waiting to be confirmed.`,
      body: `They are in the queue below. Orbis read an amount and a merchant out of each email but counts none of it as spending until you agree, and anything you reject is deleted rather than kept.${unreadable > 0 ? ` ${count(unreadable, 'alert')} could not be parsed and ${unreadable === 1 ? 'needs' : 'need'} the amount typed in.` : ''}`,
      action: null,
    };
  }
  if (!summary.connection) {
    return {
      id: 'connect-gmail',
      headline: 'Connect Gmail and this screen fills itself in.',
      body: 'Orbis reads the alert emails your bank already sends — read-only, never sending or deleting anything — and keeps each message ID so nothing is counted twice. You can also add expenses by hand below.',
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
    body: summary.connection.lastSyncAt
      ? 'Gmail is connected and syncing, so either the month is genuinely quiet or your bank has not sent an alert Orbis recognises. Adding one by hand takes a few seconds.'
      : 'Gmail is connected but has not synced yet. Run a sync below, or add an expense by hand to start the month.',
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
    { label: 'Alerts to confirm', value: String(summary.pendingCandidateCount), empty: summary.pendingCandidateCount === 0, target: null },
    { label: 'Saved transactions', value: summary.transactions.length ? count(summary.transactions.length, 'transaction') : 'None yet', empty: summary.transactions.length === 0, target: null },
  ];
}
