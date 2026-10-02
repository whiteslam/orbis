/**
 * Placing routines against the clock.
 *
 * The brief asks one question of this module: what should I be doing right now?
 * The answer is never the whole day's list, because a list is a schedule and
 * this is a note. It is the one routine that is current, plus what is still
 * unanswered behind it.
 *
 * Client-safe: pure functions over already-loaded data.
 */
import { minutesOf, type Routine, type RoutineEvent, type RoutineToday, type RoutinesSummary } from '@/lib/routines/types';

const TIME_ZONE = 'Asia/Kolkata';

/** How early a routine starts being "coming up" rather than "later today". */
export const LEAD_MINUTES = 45;
/** How long after its time a routine is still the thing you are meant to be doing. */
export const GRACE_MINUTES = 90;
/** The same, for a routine that is "usually around" a time: leaving work late is not missing it. */
export const FLEX_GRACE_MINUTES = 180;

const graceFor = (routine: Routine) => (routine.flexible ? FLEX_GRACE_MINUTES : GRACE_MINUTES);

/**
 * Where a routine stands against the clock, in the only four words the brief
 * may use for it.
 *
 * There is no 'missed'. Orbis knows the time and whether you have said
 * anything; it does not know what you did. A 7 pm routine with no answer at
 * 8 pm is one Orbis has not heard about, and that is all it may claim.
 */
export type RoutineState = 'later' | 'soon' | 'now' | 'unheard';

export function routineState(item: RoutineToday): RoutineState {
  if (item.minutesAway > LEAD_MINUTES) return 'later';
  if (item.minutesAway > 10) return 'soon';
  if (item.minutesAway >= -10) return 'now';
  return 'unheard';
}

export function localParts(now: Date, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  };
}

/** Today's routines, in clock order, each with whatever was said about it. */
export function routinesToday(summary: RoutinesSummary, now: Date, timeZone = TIME_ZONE): RoutineToday[] {
  if (summary.state !== 'ready') return [];
  const { minutes, weekday } = localParts(now, timeZone);
  const byRoutine = new Map<string, RoutineEvent>();
  for (const event of summary.events) if (event.routineId) byRoutine.set(event.routineId, event);

  return summary.routines
    .filter((routine) => routine.active && routine.days.includes(weekday))
    .map((routine) => ({ routine, minutesAway: minutesOf(routine.atTime) - minutes, event: byRoutine.get(routine.id) ?? null }))
    .sort((left, right) => minutesOf(left.routine.atTime) - minutesOf(right.routine.atTime));
}

/**
 * The routine the brief should lead with, or null.
 *
 * In order: the one happening now or just gone and still unanswered, then the
 * next one coming up. A routine already answered is never the headline — the
 * brief moves on rather than congratulating you.
 */
export function currentRoutine(today: RoutineToday[]): RoutineToday | null {
  const open = today.filter((item) => item.event === null);

  // Nearest first, and on a tie the one already under way: at exactly half past
  // between a 7:00 and a 7:20, the 7:00 is the one you are late for.
  const inPlay = open
    .filter((item) => item.minutesAway <= LEAD_MINUTES && item.minutesAway >= -graceFor(item.routine))
    .sort((left, right) => (Math.abs(left.minutesAway) - Math.abs(right.minutesAway)) || (left.minutesAway - right.minutesAway))[0];
  if (inPlay) return inPlay;

  const upcoming = open.filter((item) => item.minutesAway > LEAD_MINUTES)[0];
  return upcoming ?? null;
}

/**
 * Whether it makes sense to ask "did you do it?" yet.
 *
 * currentRoutine also returns the next routine hours ahead, so the brief can
 * say "Gym is next, at 7 pm". Asking done-or-skipped about that at 2 pm is
 * nonsense, so the check-in waits until the routine is due: within the same
 * ten minutes relativeWhen already calls "now".
 */
export function canAnswer(item: RoutineToday) {
  return item.minutesAway <= 10;
}

/** Routines whose time has passed with nothing said about them. */
export function missedRoutines(today: RoutineToday[]): RoutineToday[] {
  return today.filter((item) => item.event === null && item.minutesAway < -graceFor(item.routine));
}

/** What has been settled today, for the brief's closing line. */
export function settledToday(today: RoutineToday[]) {
  const answered = today.filter((item) => item.event !== null);
  return {
    done: answered.filter((item) => item.event?.status === 'done').length,
    total: today.length,
    answered: answered.length,
  };
}

/** "in 20 minutes", "now", "2 hours ago" — how the brief refers to the gap. */
export function relativeWhen(minutesAway: number) {
  if (Math.abs(minutesAway) <= 10) return 'now';
  if (minutesAway > 0) {
    if (minutesAway < 60) return `in ${minutesAway} minutes`;
    const hours = Math.round(minutesAway / 60);
    return `in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const ago = Math.abs(minutesAway);
  if (ago < 60) return `${ago} minutes ago`;
  const hours = Math.round(ago / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

export type { Routine, RoutineToday };

