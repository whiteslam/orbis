// What the Health tab leads with. Health data is sparse by nature, so the order
// favours a real reading of the numbers over another prompt to upload something.

import type { GoalsSummary } from '@/lib/goals/types';
import type { StepsSummary } from '@/lib/health/types';
import type { Focus, QuietRow } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count, percent, shortDate, whole } from './types.ts';

export type HealthFocusInput = {
  steps: StepsSummary;
  goals: GoalsSummary;
  documentCount: number;
  planCount: number;
  libraryState: 'ready' | 'setup' | 'unavailable';
  savedAdviceAt?: string | null;
  now?: Date;
};

function stepTrend(steps: StepsSummary) {
  if (steps.average30 === null || steps.previous30 === null || steps.previous30 <= 0) return null;
  return Math.round(((steps.average30 - steps.previous30) / steps.previous30) * 100);
}

export function composeHealthFocus({ steps, goals, documentCount, planCount, libraryState, savedAdviceAt }: HealthFocusInput): Focus {
  if (libraryState === 'setup') {
    return {
      id: 'health-setup',
      headline: 'Health documents are waiting on a database migration.',
      body: 'Apply the health documents and plans migration in Supabase to save files, build plans and keep advice. Step data and goals work without it.',
      action: null,
    };
  }
  if (libraryState === 'unavailable') {
    return {
      id: 'health-unavailable',
      headline: 'Your health library could not be loaded.',
      body: 'Saved documents and plans are temporarily out of reach. Steps and goals below are unaffected, and refreshing the app tries again.',
      action: null,
    };
  }

  const trend = stepTrend(steps);
  if (trend !== null && Math.abs(trend) >= 10 && steps.average30 !== null && steps.previous30 !== null) {
    const falling = trend < 0;
    return {
      id: falling ? 'steps-falling' : 'steps-rising',
      headline: `Your daily steps are ${falling ? 'down' : 'up'} ${Math.abs(trend)}% on the month before.`,
      body: `${whole(steps.average30)} a day over the last 30 days against ${whole(steps.previous30)} before that${steps.latest ? `, last read ${shortDate(steps.latest.date)}` : ''}.${falling ? ' Two thirty-minute walks a week is usually enough to close a gap that size.' : ' Worth keeping whatever changed.'}`,
      action: null,
    };
  }

  if (documentCount === 0) {
    return {
      id: 'upload-document',
      headline: 'Upload something you already have.',
      body: 'A blood panel, a weights sheet, an activity export — Excel or PDF, up to 100 MB. Orbis shows exactly what it read before anything is sent for advice, and quotes those numbers back when it answers.',
      action: null,
    };
  }
  if (planCount === 0) {
    return {
      id: 'no-plan',
      headline: `Turn ${documentCount === 1 ? 'that document' : 'one of those documents'} into a plan.`,
      body: 'The plan builder asks a few questions about your situation, then writes something week-by-week that cites the numbers in your own files rather than general advice.',
      action: null,
    };
  }

  const openGoals = goals.goals.filter((goal) => goal.target > 0 && goal.current < goal.target);
  if (openGoals.length > 0) {
    const goal = openGoals.slice().sort((left, right) => (left.dueDate ?? '9999').localeCompare(right.dueDate ?? '9999'))[0];
    const progress = percent(goal.current / goal.target);
    return {
      id: 'goal-progress',
      headline: `“${goal.title}” is at ${progress}.`,
      body: `${goal.target - goal.current}${goal.unit ? ` ${goal.unit}` : ''} to go${goal.dueDate ? `, with ${shortDate(goal.dueDate)} as the date you set` : ''}. Orbis shapes every plan and answer on this screen around it while it is open.`,
      action: null,
    };
  }

  return {
    id: 'health-settled',
    headline: `${count(documentCount, 'document')} and ${count(planCount, 'plan')} saved.`,
    body: savedAdviceAt
      ? `Your advice from ${shortDate(savedAdviceAt)} is below, with the observations it came from. Ask again whenever the underlying numbers change.`
      : 'Ask Orbis about any of them and it will answer from what is in the files, quoting the rows it used.',
    action: null,
  };
}

export function composeHealthRows({ steps, goals, documentCount, planCount }: Pick<HealthFocusInput, 'steps' | 'goals' | 'documentCount' | 'planCount'>): QuietRow[] {
  const trend = stepTrend(steps);
  return [
    { label: 'Steps today', value: steps.latest ? whole(steps.latest.steps) : 'Not imported', empty: !steps.latest, target: null },
    { label: '7-day average', value: steps.average7 !== null ? whole(steps.average7) : 'No data', empty: steps.average7 === null, target: null },
    { label: '30 days vs before', value: trend === null ? 'No data' : `${trend > 0 ? '+' : ''}${trend}%`, empty: trend === null, target: null },
    { label: 'Best day', value: steps.best ? `${whole(steps.best.steps)} · ${shortDate(steps.best.date)}` : 'No data', empty: !steps.best, target: null },
    { label: 'Documents', value: documentCount ? count(documentCount, 'file') : 'None yet', empty: documentCount === 0, target: null },
    { label: 'Plans', value: planCount ? String(planCount) : 'None yet', empty: planCount === 0, target: null },
    { label: 'Goals', value: goals.goals.length ? String(goals.goals.length) : 'None yet', empty: goals.goals.length === 0, target: null },
  ];
}
