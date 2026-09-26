/**
 * Routines: what you intend to do and when, and what you did about it.
 *
 * Client-safe. The whole point of this module is that a time exists at all —
 * the Home brief could previously say what was true but never what was planned.
 */
export type RoutineKind = 'workout' | 'meal' | 'hydration' | 'work' | 'wind_down' | 'other';

export const ROUTINE_KINDS: Array<{ id: RoutineKind; label: string }> = [
  { id: 'workout', label: 'Workout' },
  { id: 'meal', label: 'Meal' },
  { id: 'hydration', label: 'Water' },
  { id: 'work', label: 'Work' },
  { id: 'wind_down', label: 'Wind down' },
  { id: 'other', label: 'Something else' },
];

export type Routine = {
  id: string;
  title: string;
  kind: RoutineKind;
  /** Local wall clock, "19:00". Not a timestamp: 7pm means 7pm wherever you are. */
  atTime: string;
  /** Days this runs, 0 = Sunday. */
  days: number[];
  active: boolean;
};

export type RoutineStatus = 'done' | 'skipped' | 'other';

export type RoutineEvent = {
  id: string;
  routineId: string | null;
  title: string;
  localDate: string;
  status: RoutineStatus;
  note: string | null;
};

/** A routine placed against the clock, with whatever has been said about it today. */
export type RoutineToday = {
  routine: Routine;
  /** Minutes from now until it is due. Negative once it has passed. */
  minutesAway: number;
  event: RoutineEvent | null;
};

export type RoutinesSummary = {
  state: 'ready' | 'setup' | 'unavailable';
  routines: Routine[];
  /** Today's events, keyed by routine id. */
  events: RoutineEvent[];
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "19:00" → "7:00 pm", the way the brief says it. */
export function clockLabel(atTime: string) {
  const [hours, minutes] = atTime.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return atTime;
  const half = hours < 12 ? 'am' : 'pm';
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${hour} ${half}` : `${hour}:${String(minutes).padStart(2, '0')} ${half}`;
}

export const minutesOf = (atTime: string) => {
  const [hours, minutes] = atTime.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
};
