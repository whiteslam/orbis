import { money } from '@/lib/finance/money';
import { addDays, dayOfMonth, daysBetween, monthOf } from '@/lib/headsups/dates';
import type { Finding } from '@/lib/headsups/types';

export type Expense = { id: string; amount: number; currency: string; category: string | null; merchant: string | null; localDate: string };
export type MoneyInput = { today: string; expenses: Expense[] };

const BIG_SPEND_MULTIPLE = 3;
const BIG_SPEND_MIN_HISTORY = 5;
const BIG_SPEND_WINDOW_DAYS = 90;
const HOT_MULTIPLE = 1.3;
const HOT_FROM_DAY = 10;
const GAP_DAYS = 4;
const GAP_HABIT_SHARE = 0.6;
// Past a month, logging has stopped rather than lapsed; Orbis stops asking.
const GAP_MAX_DAYS = 30;

/** The Spending charts show one currency; the checks compare within it too. */
function inMainCurrency(expenses: Expense[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amount);
  const main = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { currency: main ?? 'INR', expenses: expenses.filter((expense) => expense.currency === main) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function bigSpend({ today, expenses: all }: MoneyInput): Finding[] {
  const { currency, expenses } = inMainCurrency(all);
  const since = addDays(today, -BIG_SPEND_WINDOW_DAYS);
  const recent = expenses.filter((expense) => expense.category && expense.localDate >= addDays(today, -1));
  return recent.flatMap((expense) => {
    const others = expenses.filter((other) => other.id !== expense.id && other.category === expense.category && other.localDate >= since);
    if (others.length < BIG_SPEND_MIN_HISTORY) return [];
    const usual = median(others.map((other) => other.amount));
    if (usual <= 0 || expense.amount < usual * BIG_SPEND_MULTIPLE) return [];
    const category = expense.category as string;
    const at = expense.merchant ? ` at ${expense.merchant}` : '';
    return [{
      kind: 'money.big_spend',
      dedupeKey: `money.big_spend:${expense.id}`,
      urgency: 'urgent',
      evidence: { category, amount: expense.amount, usual, currency, merchant: expense.merchant ?? '' },
      action: { type: 'review_category', category },
      fallback: {
        title: `A bigger ${category} spend than usual`,
        body: `${money(expense.amount, currency)}${at}. Your usual ${category} spend is about ${money(usual, currency)}.`,
        actionLabel: `See ${category}`,
      },
    } satisfies Finding];
  });
}

/** What was spent per category from day 1 to `day` of a month ('YYYY-MM'). */
function monthToDate(expenses: Expense[], month: string, day: number) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (!expense.category || monthOf(expense.localDate) !== month || dayOfMonth(expense.localDate) > day) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  }
  return totals;
}

function monthBefore(month: string, count: number) {
  const [year, index] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, index - 1 - count, 1));
  return value.toISOString().slice(0, 7);
}

export function categoryHot({ today, expenses: all }: MoneyInput): Finding[] {
  const day = dayOfMonth(today);
  if (day < HOT_FROM_DAY) return [];
  const { currency, expenses } = inMainCurrency(all);
  const month = monthOf(today);
  const previous = [1, 2, 3].map((count) => monthBefore(month, count));
  // Each earlier month needs some spending at all, or "usual" is a guess.
  if (!previous.every((earlier) => expenses.some((expense) => monthOf(expense.localDate) === earlier))) return [];
  const now = monthToDate(expenses, month, day);
  const before = previous.map((earlier) => monthToDate(expenses, earlier, day));
  return [...now].flatMap(([category, thisMonth]) => {
    const usual = before.reduce((sum, totals) => sum + (totals.get(category) ?? 0), 0) / before.length;
    if (usual <= 0 || thisMonth < usual * HOT_MULTIPLE) return [];
    return [{
      kind: 'money.category_hot',
      dedupeKey: `money.category_hot:${category}:${month}`,
      urgency: 'normal',
      evidence: { category, thisMonth, usual: Math.round(usual), day, currency },
      action: { type: 'review_category', category },
      fallback: {
        title: `${category} is running ahead this month`,
        body: `${money(thisMonth, currency)} so far, against about ${money(usual, currency)} by day ${day} in a usual month.`,
        actionLabel: `See ${category}`,
      },
    } satisfies Finding];
  });
}

export function loggingGap({ today, expenses }: MoneyInput): Finding[] {
  if (!expenses.length) return [];
  const days = [...new Set(expenses.map((expense) => expense.localDate))].sort();
  const last = days[days.length - 1];
  const quiet = daysBetween(last, today);
  if (quiet < GAP_DAYS || quiet > GAP_MAX_DAYS) return [];
  const windowStart = addDays(last, -29);
  const logged = days.filter((day) => day >= windowStart && day <= last).length;
  if (logged < 30 * GAP_HABIT_SHARE) return [];
  return [{
    kind: 'money.logging_gap',
    dedupeKey: `money.logging_gap:${last}`,
    urgency: 'normal',
    evidence: { quietDays: quiet, loggedDaysBefore: logged },
    action: { type: 'open_spending_entry' },
    fallback: {
      title: `Nothing logged for ${quiet} days`,
      body: `You usually add spending most days. Anything from the last ${quiet} days to catch up on?`,
      actionLabel: 'Add a spend',
    },
  }];
}
