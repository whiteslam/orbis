import { addDays, mondayOf } from '@/lib/headsups/dates';
import { clampWording } from '@/lib/headsups/prompt';
import type { Finding } from '@/lib/headsups/types';

export type StepDay = { date: string; steps: number };
export type PlanRow = { id: string; title: string; createdDate: string; durationWeeks: number };

const DROP_SHARE = 0.7;
const MIN_RECENT_DAYS = 5;
const MIN_BEFORE_DAYS = 14;
const PLAN_GRACE_DAYS = 3;
// A plan that ended longer ago than this is old news, not a heads-up.
const PLAN_WINDOW_DAYS = 14;

const average = (days: StepDay[]) => days.reduce((sum, day) => sum + day.steps, 0) / days.length;

export function stepsDown({ today, steps }: { today: string; steps: StepDay[] }): Finding[] {
  // Today is still being walked, so the week is the seven days before it.
  const recent = steps.filter((day) => day.date >= addDays(today, -7) && day.date < today);
  const before = steps.filter((day) => day.date >= addDays(today, -35) && day.date < addDays(today, -7));
  if (recent.length < MIN_RECENT_DAYS || before.length < MIN_BEFORE_DAYS) return [];
  const week = Math.round(average(recent));
  const usual = Math.round(average(before));
  if (usual <= 0 || week > usual * DROP_SHARE) return [];
  return [{
    kind: 'health.steps_down',
    dedupeKey: `health.steps_down:${mondayOf(today)}`,
    urgency: 'normal',
    evidence: { weekAverage: week, usualAverage: usual },
    action: { type: 'open_steps' },
    fallback: {
      title: 'Fewer steps this week',
      body: `About ${week.toLocaleString('en-IN')} a day this week, against your usual ${usual.toLocaleString('en-IN')}.`,
      actionLabel: 'See steps',
    },
  }];
}

export function planFinished({ today, plan }: { today: string; plan: PlanRow | null }): Finding[] {
  if (!plan) return [];
  const ends = addDays(plan.createdDate, Math.max(1, plan.durationWeeks) * 7 - 1);
  if (today < addDays(ends, PLAN_GRACE_DAYS) || today > addDays(ends, PLAN_WINDOW_DAYS)) return [];
  return [{
    kind: 'health.plan_finished',
    dedupeKey: `health.plan_finished:${plan.id}`,
    urgency: 'normal',
    evidence: { plan: plan.title, weeks: plan.durationWeeks },
    action: { type: 'open_health_plan', planId: plan.id },
    fallback: clampWording({
      title: `${plan.title} has finished`,
      body: `Your ${plan.durationWeeks}-week plan is done. Want to build what comes next?`,
      actionLabel: 'Open plans',
    }),
  }];
}
