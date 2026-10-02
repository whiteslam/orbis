'use client';

import { ActivityRings } from '@/components/health/activity-rings';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';
import { recentDays } from '@/lib/focus/widgets';
import type { FocusTarget } from '@/lib/focus/types';
import type { StepsSummary } from '@/lib/health/types';

const STEP_GOAL = 10_000;

/** Truthful only if `latest` really is today's count — steps import can lag, so the
 *  aria-label says which day it's reporting instead of always claiming "today". */
function activityLabel(steps: StepsSummary, todayIso: string) {
  if (!steps.latest) return 'Activity: import your steps';
  const count = steps.latest.steps.toLocaleString('en-IN');
  const when = steps.latest.date === todayIso
    ? 'today'
    : `on ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(steps.latest.date))}`;
  const average = steps.average7 != null ? `, 7-day average ${Math.round(steps.average7).toLocaleString('en-IN')}` : '';
  return `Activity: ${count} steps ${when}${average}`;
}

// The spending widget always draws a week of slots, so two days into a month
// the bars are still bars rather than two blocks filling the row.
const BAR_SLOTS = 7;

/** Two square widgets under the brief: today's activity and this month's spending. Each opens its tab. */
export function TodayWidgets({ steps, month, openTab }: { steps: StepsSummary; month: FinanceSummary['month']; openTab: (target: FocusTarget) => void }) {
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const today = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const bars = month ? recentDays(month.daily, today, BAR_SLOTS) : [];
  const blanks = Math.max(0, BAR_SLOTS - bars.length);
  const latest = steps.latest;
  // Steps arrive by import, so the count is labelled with its own day unless that day is today.
  const stepsDay = !latest ? '' : latest.date === todayIso
    ? 'today'
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(latest.date));
  const perDay = month && month.spent > 0 ? month.spent / Math.max(today, 1) : null;
  const top = month?.categories.reduce<{ category: string; amount: number } | null>((best, item) => (!best || item.amount > best.amount ? item : best), null) ?? null;
  return (
    <div className="today-widgets">
      <button type="button" className="today-widget" onClick={() => openTab('health')} aria-label={activityLabel(steps, todayIso)}>
        <span className="today-widget-cap">Activity</span>
        {latest ? (
          <>
            <ActivityRings size={70} rings={[
              { label: 'Steps', value: latest.steps / STEP_GOAL, color: 'var(--series-3)', track: 'var(--fd-ring-track)' },
              { label: '7-day average', value: (steps.average7 ?? 0) / STEP_GOAL, color: 'var(--series-1)', track: 'var(--fd-ring-track)' },
            ]} />
            <span className="today-widget-foot">
              <span className="today-widget-value small" suppressHydrationWarning>{latest.steps.toLocaleString('en-IN')}<small> steps {stepsDay}</small></span>
              <span className="today-widget-sub">
                {Math.round((latest.steps / STEP_GOAL) * 100)}% of {STEP_GOAL.toLocaleString('en-IN')}
                {steps.average7 != null ? ` · avg ${Math.round(steps.average7).toLocaleString('en-IN')}` : ''}
              </span>
            </span>
          </>
        ) : <span className="today-widget-empty">Import your steps</span>}
      </button>
      <button type="button" className="today-widget" onClick={() => openTab('finance')} aria-label={month ? `Spent this month: ${money(month.spent, month.currency)}` : 'Spent this month: add what you spend'}>
        <span className="today-widget-cap">Spent this month</span>
        {month ? (
          <>
            <span className="today-widget-foot">
              <span className="today-widget-value">{money(month.spent, month.currency)}</span>
              {perDay !== null && <span className="today-widget-sub" suppressHydrationWarning>{money(perDay, month.currency)} a day</span>}
              {top && top.amount > 0 && <span className="today-widget-sub">Most on {top.category}</span>}
            </span>
            <span className="today-widget-bars" aria-hidden="true">
              {Array.from({ length: blanks }, (_, index) => <i key={`blank-${index}`} className="none" />)}
              {bars.map((entry) => <i key={entry.day} className={entry.day === today ? 'now' : undefined} style={{ height: `${Math.max(8, entry.share * 100)}%` }} />)}
            </span>
          </>
        ) : <span className="today-widget-empty">Add what you spend</span>}
      </button>
    </div>
  );
}
