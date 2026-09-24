'use client';

import { useState } from 'react';
import { categoryStyle } from '@/components/finance/category-style';
import type { FinanceSummary } from '@/lib/finance/types';

type Month = NonNullable<FinanceSummary['month']>;

export function money(amount: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: compact || amount >= 1000 ? 0 : 2, notation: compact ? 'compact' : 'standard' }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
}

const SIZE = 148;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

// Apple Card-style ring: one arc per category, sized by its share of the month's spending.
function CategoryRing({ month, active, onSelect }: { month: Month; active: string | null; onSelect: (category: string | null) => void }) {
  const segments = month.categories.length > 7
    ? [...month.categories.slice(0, 6), { category: 'Other', amount: month.categories.slice(6).reduce((sum, item) => sum + item.amount, 0) }]
    : month.categories;
  let offset = 0;
  const focused = segments.find((segment) => segment.category === active);
  return (
    <div className="spend-ring">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Spending by category: ${segments.map((segment) => `${segment.category} ${money(segment.amount, month.currency)}`).join(', ')}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#eeeef3" strokeWidth={STROKE} />
        {segments.map((segment) => {
          const length = (segment.amount / month.spent) * CIRCUMFERENCE;
          const visible = Math.max(length - (segments.length > 1 ? GAP : 0), 1.5);
          const dash = `${visible} ${CIRCUMFERENCE - visible}`;
          const element = (
            <circle
              key={segment.category}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={categoryStyle(segment.category).color}
              strokeWidth={STROKE}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              opacity={active && active !== segment.category ? 0.25 : 1}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              onClick={() => onSelect(active === segment.category ? null : segment.category)}
            />
          );
          offset += length;
          return element;
        })}
      </svg>
      <div className="spend-ring-center">
        <span>{focused ? focused.category : 'Spent'}</span>
        <strong>{money(focused ? focused.amount : month.spent, month.currency, (focused ? focused.amount : month.spent) >= 100_000)}</strong>
      </div>
    </div>
  );
}

export function SpendingSummary({ month }: { month: Month }) {
  const [active, setActive] = useState<string | null>(null);
  const monthName = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
  const net = month.received - month.spent;
  const peak = Math.max(...month.daily.map((day) => day.amount), 1);
  const today = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const spendDays = month.daily.filter((day) => day.day <= today);
  const dailyAverage = spendDays.length ? month.spent / spendDays.length : 0;

  return (
    <>
      <section className="apple-card spend-card" aria-label={`${monthName} spending`}>
        {month.spent > 0 ? (
          <div className="spend-overview">
            <CategoryRing month={month} active={active} onSelect={setActive} />
            <ul className="spend-legend">
              {month.categories.slice(0, 5).map((item) => (
                <li key={item.category}>
                  <button type="button" aria-pressed={active === item.category} className={active && active !== item.category ? 'dim' : ''} onClick={() => setActive(active === item.category ? null : item.category)}>
                    <i style={{ background: categoryStyle(item.category).color }} />
                    <span>{item.category}</span>
                    <b>{Math.round((item.amount / month.spent) * 100)}%</b>
                  </button>
                </li>
              ))}
              {month.categories.length > 5 && <li className="spend-legend-more">+{month.categories.length - 5} more</li>}
            </ul>
          </div>
        ) : (
          <p className="apple-card-empty">No spending recorded in {monthName} yet.</p>
        )}
        <dl className="spend-totals">
          <div><dt>Spent</dt><dd>{money(month.spent, month.currency)}</dd></div>
          <div><dt>Received</dt><dd className="positive">{money(month.received, month.currency)}</dd></div>
          <div><dt>Net</dt><dd className={net >= 0 ? 'positive' : 'negative'}>{net >= 0 ? '+' : '−'}{money(Math.abs(net), month.currency)}</dd></div>
        </dl>
      </section>

      {month.spent > 0 && (
        <section className="apple-card">
          <header className="apple-card-head">
            <strong>Daily spending</strong>
            <span>{monthName}</span>
          </header>
          <p className="apple-metric"><b>{money(dailyAverage, month.currency)}</b> average a day</p>
          <div className="spend-bars" role="img" aria-label={`Daily spending in ${monthName}`}>
            {month.daily.map((day) => (
              <div key={day.day} className={day.day === today ? 'today' : day.day > today ? 'future' : ''} title={`${day.day} ${monthName}: ${money(day.amount, month.currency)}`}>
                <i style={{ height: `${day.amount ? Math.max((day.amount / peak) * 100, 4) : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="spend-bars-axis"><span>1</span><span>{Math.ceil(month.daily.length / 2)}</span><span>{month.daily.length}</span></div>
        </section>
      )}
    </>
  );
}
