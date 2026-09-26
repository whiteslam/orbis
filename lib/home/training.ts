/**
 * Today's training, as the Home brief reads it.
 *
 * Derived from the active plan rather than the whole library: the brief says
 * what today asks of you, and the Health tab holds everything else.
 */
export type BriefTraining = {
  /** 'off' when no plan is saved, so the brief says nothing rather than improvising one. */
  state: 'ok' | 'off';
  planTitle: string;
  today: {
    focus: string;
    rest: boolean;
    durationMinutes: number | null;
    /** The first few movements, named. Enough to know what you are walking into. */
    exercises: string[];
  } | null;
};

type PlanLike = {
  title: string;
  workout: { week: Array<{ day: string; focus: string; rest: boolean; durationMinutes: number | null; exercises: Array<{ name: string }> }> };
};

/** Picks the day in the plan's week that matches today, in the user's timezone. */
export function trainingForToday(plan: PlanLike | null, now = new Date()): BriefTraining {
  if (!plan) return { state: 'off', planTitle: '', today: null };
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(now).toLowerCase();
  const match = plan.workout.week.find((day) => day.day.trim().toLowerCase().startsWith(weekday.slice(0, 3)));
  return {
    state: 'ok',
    planTitle: plan.title,
    today: match
      ? {
        focus: match.focus,
        rest: match.rest,
        durationMinutes: match.durationMinutes,
        exercises: match.exercises.slice(0, 3).map((exercise) => exercise.name).filter(Boolean),
      }
      : null,
  };
}
