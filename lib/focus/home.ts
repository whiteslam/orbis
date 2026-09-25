// The Home brief: a short, swipeable sequence of things worth saying today.
//
// Three tiers, in this order. First what needs attention — something broken,
// something waiting, a date that has arrived. Then what is worth knowing: real
// readings of data already there, the month's pace, the step trend, the weather
// as it affects the day. Setup tasks come last, because a nudge to connect
// something is never more important than what the app already knows. Slides only
// exist when there is something true to put in them, so a quiet account gets one
// slide, not five empty ones.

import type { FinanceSummary } from '@/lib/finance/types';
import type { GoalsSummary } from '@/lib/goals/types';
import type { StepsSummary } from '@/lib/health/types';
import type { Focus, FocusTarget, QuietRow } from '@/lib/focus/types';
import { count, istParts, money, shortDate, whole } from '@/lib/focus/types';
import type { BriefWeather } from '@/lib/home/brief';

export type { Focus, FocusTarget, QuietRow };

export type FocusInput = {
  finance: FinanceSummary;
  goals: GoalsSummary;
  steps: StepsSummary;
  /** How many health documents are saved; drives the "upload something" step. */
  documentCount: number;
  weather?: BriefWeather | null;
  name?: string | null;
  /** When advice was last generated, so a fresh answer is offered rather than re-asked for. */
  savedAdviceAt?: string | null;
  now?: Date;
};

const MAX_SLIDES = 4;

function daysUntil(dueDate: string, now: Date) {
  const today = istParts(now);
  const key = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86_400_000);
}

function partOfDay(hour: number) {
  if (hour < 5) return 'tonight';
  if (hour < 12) return 'this morning';
  if (hour < 17) return 'this afternoon';
  return 'tonight';
}

function greeting(hour: number, name: string | null) {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Still up${who}?`;
  if (hour < 12) return `Good morning${who}.`;
  if (hour < 17) return `Good afternoon${who}.`;
  if (hour < 22) return `Good evening${who}.`;
  return `Winding down${who}?`;
}

function stepTrend(steps: StepsSummary) {
  if (steps.average30 === null || steps.previous30 === null || steps.previous30 <= 0) return null;
  return Math.round(((steps.average30 - steps.previous30) / steps.previous30) * 100);
}

/** Broken, waiting, or out of time — the things that cannot wait a day. */
function needsAttention({ finance, goals, now }: { finance: FinanceSummary; goals: GoalsSummary; now: Date }): Focus[] {
  const slides: Focus[] = [];

  if (finance.loadError) {
    slides.push({
      id: 'finance-unavailable',
      headline: 'I can’t load your finance data.',
      body: 'Spending and alerts are stale until that clears. Opening Finance tries again.',
      action: { label: 'Open Finance', target: 'finance' },
      art: 'broken',
      source: 'Orbis storage · last read failed',
    });
  }
  if (finance.connection?.status === 'reconnect_required') {
    slides.push({
      id: 'gmail-reconnect',
      headline: 'Gmail dropped the connection.',
      body: `Google expired access for ${finance.connection.email}, so no new alerts are coming in. Nothing saved is lost.`,
      action: { label: 'Reconnect', target: 'finance' },
      art: 'broken',
      source: `Gmail · ${finance.connection.email}`,
    });
  }
  if (finance.pendingCandidateCount > 0) {
    const alerts = finance.pendingCandidateCount;
    slides.push({
      id: 'review-alerts',
      headline: alerts === 1 ? 'One alert needs a yes or no.' : `${alerts} alerts need a yes or no.`,
      body: `I read the amount and merchant from each email. Nothing counts as spending until you confirm it — ${alerts <= 3 ? 'a minute, tops' : `about ${Math.ceil(alerts / 4)} minutes`}.`,
      action: { label: alerts === 1 ? 'Review it' : 'Review them', target: 'finance' },
      art: 'alerts',
      source: `Gmail · ${count(alerts, 'alert')} read`,
    });
  }
  const dated = goals.goals
    .filter((goal) => goal.dueDate && goal.target > 0 && goal.current < goal.target)
    .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? ''))[0];
  if (dated?.dueDate) {
    const left = daysUntil(dated.dueDate, now);
    const progress = Math.min(99, Math.round((dated.current / dated.target) * 100));
    const remaining = Math.max(0, dated.target - dated.current);
    const unit = dated.unit ? ` ${dated.unit}` : '';
    if (left < 0) {
      slides.push({
        id: 'goal-overdue',
        headline: `“${dated.title}” is past its date at ${progress}%.`,
        body: `${remaining}${unit} to go, ${count(Math.abs(left), 'day')} late. Moving the date is fine — a stale one helps neither of us.`,
        action: { label: 'Set a new date', target: 'health' },
        art: 'goal',
        source: `Goals · due ${shortDate(dated.dueDate)}`,
      });
    } else if (left <= 14) {
      slides.push({
        id: 'goal-due-soon',
        headline: left === 0 ? `Today is your date for “${dated.title}”.` : `${count(left, 'day')} left on “${dated.title}”, at ${progress}%.`,
        body: `${remaining}${unit} to go. I’ll shape anything you ask me around it until then.`,
        action: { label: 'Open goals', target: 'health' },
        art: 'goal',
        source: `Goals · due ${shortDate(dated.dueDate)}`,
      });
    }
  }

  return slides;
}

/** Setup that would make Orbis more useful. Useful is not urgent, so these go last. */
function setupTasks({ finance, goals, documentCount, when }: { finance: FinanceSummary; goals: GoalsSummary; documentCount: number; when: string }): Focus[] {
  const slides: Focus[] = [];
  if (finance.databaseReady && !finance.connection) {
    slides.push({
      id: 'connect-gmail',
      headline: `Connect Gmail and I can start your expenses ${when}.`,
      body: 'Read-only, bank alerts only, never the message body. Two minutes to set up, one tap to undo.',
      action: { label: 'Connect Gmail', target: 'finance' },
      art: 'link',
      source: 'Nothing connected yet',
    });
  }
  if (documentCount === 0) {
    slides.push({
      id: 'upload-workbook',
      headline: `Upload a workbook and I’ll read it ${when}.`,
      body: 'Any Excel or PDF you already keep. You see exactly what I read before a word of it is sent anywhere.',
      action: { label: 'Open Health', target: 'health' },
      art: 'document',
      source: 'No documents saved',
    });
  }
  if (goals.databaseReady && goals.goals.length === 0) {
    slides.push({
      id: 'set-goal',
      headline: 'Set one goal and the rest starts pointing at it.',
      body: 'A title, a number, a date. Without one I can only describe what I see.',
      action: { label: 'Add a goal', target: 'health' },
      art: 'goal',
      source: 'No goals set',
    });
  }
  return slides;
}

/** Readings of data already there: true, specific, and nothing to do about them. */
function worthKnowing({ finance, goals, steps, weather, savedAdviceAt, now, when }: FocusInput & { now: Date; when: string }): Focus[] {
  const today = istParts(now);
  const slides: Focus[] = [];

  const spend = finance.monthlyExpenses.length === 1 ? finance.monthlyExpenses[0] : null;
  if (spend && spend.amount > 0) {
    const perDay = spend.amount / Math.max(today.day, 1);
    const projection = perDay * 30;
    slides.push({
      id: 'spending-pace',
      headline: `${money(spend.amount, spend.currency)} spent this month.`,
      body: `About ${money(perDay, spend.currency)} a day — at this pace the month lands near ${money(projection, spend.currency)}.`,
      action: { label: 'See where', target: 'finance' },
      art: 'money',
      source: `Gmail · ${count(finance.transactions.length, 'transaction')} confirmed`,
    });
  }

  const trend = stepTrend(steps);
  if (trend !== null && Math.abs(trend) >= 10 && steps.average30 !== null && steps.previous30 !== null) {
    const falling = trend < 0;
    slides.push({
      id: falling ? 'steps-falling' : 'steps-rising',
      headline: `Steps ${falling ? 'down' : 'up'} ${Math.abs(trend)}% on last month.`,
      body: `${whole(steps.average30)} a day, from ${whole(steps.previous30)}. ${falling ? 'Two half-hour walks a week would close that.' : 'Whatever changed, keep it.'}`,
      action: { label: 'See activity', target: 'health' },
      art: falling ? 'steps-down' : 'steps-up',
      source: `Apple Health · ${count(steps.days.length, 'day')} imported`,
    });
  }

  const moving = goals.goals.find((goal) => goal.target > 0 && goal.current > 0 && goal.current < goal.target && !goal.dueDate);
  if (moving) {
    const progress = Math.round((moving.current / moving.target) * 100);
    slides.push({
      id: 'goal-moving',
      headline: `“${moving.title}” is at ${progress}%.`,
      body: `${moving.target - moving.current}${moving.unit ? ` ${moving.unit}` : ''} to go, no date set. Give it one and I can tell you if you’re on track.`,
      action: { label: 'Open goals', target: 'health' },
      art: 'goal',
      source: 'Goals · no date set',
    });
  }

  if (weather) {
    const rain = weather.rainProbability >= 60;
    const hot = weather.temperature >= 36;
    const cold = weather.temperature <= 12;
    if (rain || hot || cold) {
      slides.push({
        id: 'weather-note',
        headline: rain
          ? `Rain ${when} — ${weather.rainProbability}% chance.`
          : `It’s ${hot ? '' : 'only '}${weather.temperature}° out.`,
        body: rain
          ? `${weather.condition}. Worth moving anything outdoors earlier, or indoors.`
          : hot
            ? 'Go easy in the afternoon sun. An early or late walk beats a midday one.'
            : 'Layer up. Cold days are when step counts quietly slip.',
        action: null,
        art: rain ? 'rain' : hot ? 'sun' : 'cold',
        source: `Open-Meteo · ${weather.condition}`,
      });
    }
  }

  if (savedAdviceAt) {
    slides.push({
      id: 'saved-advice',
      headline: `Your advice from ${shortDate(savedAdviceAt)} is still here.`,
      body: 'It’s in Health with the numbers it came from, so you can reread it without spending a request.',
      action: { label: 'Read it', target: 'health' },
      art: 'saved',
      source: `Saved to your account · ${shortDate(savedAdviceAt)}`,
    });
  }

  return slides;
}

/** The Home brief, in order: what needs you, then what is worth knowing. */
export function composeFocus(input: FocusInput): Focus[] {
  const now = input.now ?? new Date();
  const today = istParts(now);
  const when = partOfDay(today.hour);
  const firstName = input.name?.trim().split(/\s+/)[0] || null;

  const slides = [
    ...needsAttention({ finance: input.finance, goals: input.goals, now }),
    ...worthKnowing({ ...input, now, when }),
    ...setupTasks({ finance: input.finance, goals: input.goals, documentCount: input.documentCount, when }),
  ];
  if (slides.length) return slides.slice(0, MAX_SLIDES);

  // Nothing to act on and nothing to report: say so, in the voice of the hour.
  return [{
    id: 'calm',
    headline: greeting(today.hour, firstName),
    body: 'Nothing needs you: no alerts, no dates coming up, nothing waiting in Finance or Health.',
    action: null,
    art: 'calm',
    source: 'Checked everything you have connected',
  }];
}

/** The hairline rows under the brief: state, never calls to action. */
export function composeQuietRows({ finance, goals, steps, documentCount }: Pick<FocusInput, 'finance' | 'goals' | 'steps' | 'documentCount'>): QuietRow[] {
  const spend = finance.monthlyExpenses.length === 1 ? finance.monthlyExpenses[0] : null;
  const expenses = spend
    ? money(spend.amount, spend.currency)
    : finance.monthlyExpenses.length > 1
      ? 'Several currencies'
      : 'No data';
  const stepsValue = steps.average7 !== null ? `${whole(steps.average7)} a day` : 'Not imported';

  return [
    { label: 'Spending this month', value: expenses, empty: !spend && finance.monthlyExpenses.length === 0, target: 'finance' },
    { label: 'Alerts to confirm', value: String(finance.pendingCandidateCount), empty: finance.pendingCandidateCount === 0, target: 'finance' },
    { label: 'Active goals', value: String(goals.goals.length), empty: goals.goals.length === 0, target: 'health' },
    { label: 'Steps, 7-day average', value: stepsValue, empty: steps.average7 === null, target: 'health' },
    { label: 'Health documents', value: documentCount ? count(documentCount, 'file') : 'None yet', empty: documentCount === 0, target: 'health' },
  ];
}
