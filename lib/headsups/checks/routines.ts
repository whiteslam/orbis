import { addDays, weekday } from '@/lib/headsups/dates';
import { clampWording } from '@/lib/headsups/prompt';
import type { Finding } from '@/lib/headsups/types';

export type RoutineRow = {
  id: string; title: string; days: number[]; active: boolean; archivedAt: string | null; createdDate: string;
  /** The last day it was done, however long ago: events are only loaded for LOOK_BACK_DAYS. */
  lastDoneDate: string | null;
};
export type RoutineEventRow = { routineId: string | null; localDate: string; status: 'done' | 'skipped' | 'other' };

const MISSED_IN_A_ROW = 3;
const LOOK_BACK_DAYS = 14;

/** The last `count` days before today this routine was meant to happen, newest first. */
function lastScheduled(routine: RoutineRow, today: string, count: number) {
  const found: string[] = [];
  for (let back = 1; back <= LOOK_BACK_DAYS && found.length < count; back += 1) {
    const date = addDays(today, -back);
    if (date < routine.createdDate) break;
    if (routine.days.includes(weekday(date))) found.push(date);
  }
  return found;
}

export function routineSlipping({ today, routines, events }: { today: string; routines: RoutineRow[]; events: RoutineEventRow[] }): Finding[] {
  return routines.flatMap((routine) => {
    if (!routine.active || routine.archivedAt) return [];
    const scheduled = lastScheduled(routine, today, MISSED_IN_A_ROW);
    if (scheduled.length < MISSED_IN_A_ROW) return [];
    const doneDates = events.filter((event) => event.routineId === routine.id && event.status === 'done').map((event) => event.localDate).sort();
    if (scheduled.some((date) => doneDates.includes(date))) return [];
    // Keyed on the last time it was done, so one slump is one heads-up however long it lasts.
    const latest = [routine.lastDoneDate, doneDates[doneDates.length - 1]].filter((date): date is string => Boolean(date)).sort();
    const lastDone = latest[latest.length - 1] ?? 'never';
    return [{
      kind: 'routine.slipping',
      dedupeKey: `routine.slipping:${routine.id}:since:${lastDone}`,
      urgency: 'urgent',
      evidence: { routine: routine.title, missedInARow: MISSED_IN_A_ROW },
      action: { type: 'adjust_routine', routineId: routine.id },
      fallback: clampWording({
        title: `${routine.title} hasn’t happened lately`,
        body: `The last ${MISSED_IN_A_ROW} times it was due, it wasn’t marked done. A different time or fewer days might suit it better.`,
        actionLabel: 'Adjust it',
      }),
    } satisfies Finding];
  });
}
