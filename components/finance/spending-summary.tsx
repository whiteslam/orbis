'use client';

import { categoryStyle } from '@/components/finance/category-style';
import { FieldLabel } from '@/components/field/field';
import type { FinanceSummary } from '@/lib/finance/types';

type Month = NonNullable<FinanceSummary['month']>;

export function money(amount: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: compact || amount >= 1000 ? 0 : 2, notation: compact ? 'compact' : 'standard' }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
}

const SHOWN_CATEGORIES = 5;

/**
 * The month, in the Atlas language.
 *
 * This used to be two lifted cards: a tappable category donut whose centre
 * repeated the month's total, and a 90px bar chart below it. The total is now
 * the screen's hero figure, so repeating it in a ring was the same sentence
 * said twice — and a donut only ever showed one category's amount at a time,
 * behind a tap.
 *
 * What replaces it is flush to the ground: a low bar strip for the shape of the
 * month, then one hairline row per category with its share drawn inline, so
 * every amount is legible at once without touching anything.
 */
export function SpendingSummary({ month }: { month: Month }) {
  const monthName = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
  const shortMonth = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  const net = month.received - month.spent;

  if (month.spent <= 0) {
    return <p className="fd-empty">No spending recorded in {monthName} yet.</p>;
  }

  const peak = Math.max(...month.daily.map((day) => day.amount), 1);
  const today = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const elapsed = month.daily.filter((day) => day.day <= today).length;
  const dailyAverage = elapsed ? month.spent / elapsed : 0;

  // Bars are sized against the busiest day so the shape of the month reads;
  // rows are sized against the biggest category for the same reason.
  const shown = month.categories.slice(0, SHOWN_CATEGORIES);
  const rest = month.categories.slice(SHOWN_CATEGORIES);
  const restTotal = rest.reduce((sum, item) => sum + item.amount, 0);
  const largest = month.categories[0]?.amount ?? 1;

  return (
    <>
      <div className="fd-bars" role="img" aria-label={`Spending each day in ${monthName}. Busiest day ${money(peak, month.currency)}, averaging ${money(dailyAverage, month.currency)} a day.`}>
        {month.daily.map((day) => (
          <span key={day.day} className={day.day === today ? 'today' : day.day > today ? 'future' : undefined}>
            <i style={{ height: day.amount ? `${Math.max((day.amount / peak) * 100, 4)}%` : 0 }} />
          </span>
        ))}
      </div>
      <div className="fd-bars-axis">
        <span suppressHydrationWarning>1 {shortMonth}</span>
        <span suppressHydrationWarning>{money(dailyAverage, month.currency)} a day</span>
        <span suppressHydrationWarning>{month.daily.length} {shortMonth}</span>
      </div>

      <FieldLabel>Where it went</FieldLabel>
      {shown.map((item) => (
        <div className="fd-cat" key={item.category}>
          <i className="fd-cat-dot" style={{ background: categoryStyle(item.category).color }} aria-hidden="true" />
          <span className="fd-cat-name">{item.category}</span>
          <span className="fd-cat-bar" aria-hidden="true">
            <i style={{ width: `${Math.max((item.amount / largest) * 100, 3)}%`, background: categoryStyle(item.category).color }} />
          </span>
          <b>{money(item.amount, month.currency)}</b>
        </div>
      ))}
      {rest.length > 0 && (
        <p className="fd-empty">{rest.length} more {rest.length === 1 ? 'category' : 'categories'} · {money(restTotal, month.currency)}</p>
      )}

      <div className="fd-pair">
        <div>
          <span>Received</span>
          <b className="up">{money(month.received, month.currency)}</b>
        </div>
        <div>
          <span>Net</span>
          <b className={net >= 0 ? 'up' : 'down'}>{net >= 0 ? '+' : '−'}{money(Math.abs(net), month.currency)}</b>
        </div>
      </div>
    </>
  );
}
