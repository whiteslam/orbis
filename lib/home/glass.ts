import type { RoutineToday } from '../routines/types.ts';

/** Daily step goal the rings and the Glass activity widget measure against. */
export const STEP_GOAL = 10_000;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * What the Glass activity widget shows. Steps only count when the latest sync
 * is for today: an older day's steps are not today's.
 */
export function glassActivity(input: {
  latest: { date: string; steps: number } | null;
  today: string;
  done: number;
  total: number;
}): { steps: number | null; stepShare: number; routineShare: number; done: number; total: number } {
  const { latest, today, done, total } = input;
  const steps = latest && latest.date === today ? latest.steps : null;
  return {
    steps,
    stepShare: steps === null ? 0 : clamp01(steps / STEP_GOAL),
    routineShare: total > 0 ? clamp01(done / total) : 0,
    done,
    total,
  };
}

/** Routines still ahead today that nobody has answered, soonest first. */
export function restOfToday(due: RoutineToday[], max = 4): Array<{ id: string; name: string; time: string }> {
  return due
    .filter((d) => d.minutesAway > 0 && d.event === null)
    .sort((a, b) => a.minutesAway - b.minutesAway)
    .slice(0, max)
    .map((d) => ({ id: d.routine.id, name: d.routine.title, time: d.routine.atTime }));
}

export type Sky = 'night' | 'rain' | 'cloud' | 'clear';

/** The Glass weather widget's tint: night first, then rain falling now, then cloud or fog (WMO 1–48), else clear. */
export function skyFor(weather: { isDay: boolean; rainingNow: boolean; weatherCode: number }): Sky {
  if (!weather.isDay) return 'night';
  if (weather.rainingNow) return 'rain';
  if (weather.weatherCode >= 1 && weather.weatherCode <= 48) return 'cloud';
  return 'clear';
}
