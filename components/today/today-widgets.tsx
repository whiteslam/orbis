'use client';

import { ActivityRings } from '@/components/health/activity-rings';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';
import { recentDays } from '@/lib/focus/widgets';
import type { FocusTarget } from '@/lib/focus/types';
import type { StepsSummary } from '@/lib/health/types';

const STEP_GOAL = 10_000;

/** Two square widgets under the brief: today's activity and this month's spending. Each opens its tab. */
export function TodayWidgets({ steps, month, openTab }: { steps: StepsSummary; month: FinanceSummary['month']; openTab: (target: FocusTarget) => void }) {
  const today = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const bars = month ? recentDays(month.daily, today) : [];
  return (
    <div className="today-widgets">
      <button type="button" className="today-widget" onClick={() => openTab('health')} aria-label={steps.latest ? `Activity: ${steps.latest.steps.toLocaleString('en-IN')} steps today` : 'Activity: import your steps'}>
        <span className="today-widget-cap">Activity</span>
        {steps.latest ? (
          <ActivityRings size={104} rings={[
            { label: 'Steps', value: steps.latest.steps / STEP_GOAL, color: 'var(--series-3)', track: 'var(--fd-ring-track)' },
            { label: '7-day average', value: (steps.average7 ?? 0) / STEP_GOAL, color: 'var(--series-1)', track: 'var(--fd-ring-track)' },
          ]} />
        ) : <span className="today-widget-empty">Import your steps</span>}
      </button>
      <button type="button" className="today-widget" onClick={() => openTab('finance')} aria-label={month ? `Spent this month: ${money(month.spent, month.currency)}` : 'Spent this month: add what you spend'}>
        <span className="today-widget-cap">Spent this month</span>
        {month ? (
          <>
            <span className="today-widget-value">{money(month.spent, month.currency)}</span>
            <span className="today-widget-bars" aria-hidden="true">
              {bars.map((entry) => <i key={entry.day} className={entry.day === today ? 'now' : undefined} style={{ height: `${Math.max(8, entry.share * 100)}%` }} />)}
            </span>
          </>
        ) : <span className="today-widget-empty">Add what you spend</span>}
      </button>
    </div>
  );
}
