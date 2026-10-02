import 'server-only';

import { isInvestmentCategory } from '@/lib/finance/manual';
import { createAdminClient } from '@/lib/supabase/admin';
import { localClock, type Slot } from '@/lib/notifications/schedule';
import type { BriefRoutine } from '@/lib/home/ai-brief';
import { currentRoutine, missedRoutines, routineState, routinesToday } from '@/lib/routines/today';
import { clockLabel, type Routine, type RoutineEvent, type RoutineKind, type RoutineStatus } from '@/lib/routines/types';
import { socialReminder } from '@/lib/social/month';
import type { SocialFormat, SocialStatus } from '@/lib/social/types';

type Admin = ReturnType<typeof createAdminClient>;

export type NotificationContext = {
  slot: Slot;
  localDate: string;
  localTime: string;
  name: string | null;
  fitness: string | null;
  routines: Array<{ title: string; at: string; status: string | null }>;
  /**
   * The one routine that matters right now, placed against the clock exactly as
   * the home brief places it, so the 7 pm push and the 7 pm note cannot disagree
   * about the same routine. Null when nothing is open today.
   */
  routine: BriefRoutine | null;
  /** Routines whose time went by with nothing said; the brief says it has not heard, never that they were missed. */
  missedCount: number;
  spending: { currency: string; today: number; month: number; todayCount: number } | null;
  stepsToday: number | null;
  /** Today's planned social posts as one morning line; '' in other slots or when nothing is due. */
  socialLine: string;
};

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type RoutineRow = { id: unknown; title: unknown; kind?: unknown; at_time: unknown; days: unknown; flexible?: unknown };

// Before the routine_flexible migration there is no flexible column; the day
// still works without it, every routine simply counted as exact.
async function loadRoutines(admin: Admin, userId: string): Promise<{ data: RoutineRow[] | null }> {
  const list = (columns: string) => admin.from('routines').select(columns).eq('user_id', userId).eq('active', true).order('at_time').limit(20);
  const full = await list('id,title,kind,at_time,days,flexible');
  if (full.error?.code !== '42703') return { data: (full.data ?? null) as unknown as RoutineRow[] | null };
  const basic = await list('id,title,kind,at_time,days');
  return { data: (basic.data ?? null) as unknown as RoutineRow[] | null };
}

// Small, trimmed facts about the user's day. Runs from the scheduler (no browser session), so it reads with the
// service role and every query is filtered by user_id. Missing tables or errors simply leave a section empty.
export async function buildNotificationContext(admin: Admin, userId: string, slot: Slot, now: Date, timeZone: string): Promise<NotificationContext> {
  const clock = localClock(now, timeZone);
  const localDate = clock.date;
  const localTime = `${String(Math.floor(clock.minutes / 60)).padStart(2, '0')}:${String(clock.minutes % 60).padStart(2, '0')}`;

  const [social, profile, persona, routines, events, transactions, steps] = await Promise.all([
    // One social nudge a day at most: it is only looked up for the morning slot.
    slot === 'morning'
      ? admin.from('social_posts').select('planned_for,status,format,media_path').eq('user_id', userId).eq('planned_for', localDate).neq('status', 'published').limit(30)
      : Promise.resolve({ data: [], error: null }),
    admin.from('user_personal_profiles').select('preferred_name').eq('user_id', userId).maybeSingle(),
    admin.from('user_fitness_personas').select('persona').eq('user_id', userId).maybeSingle(),
    loadRoutines(admin, userId),
    admin.from('routine_events').select('routine_id,status,note').eq('user_id', userId).eq('local_date', localDate).limit(20),
    admin.from('transactions').select('amount,currency,occurred_at,category').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', `${shift(localDate, -32)}T00:00:00Z`).limit(500),
    admin.from('health_daily_steps').select('steps').eq('user_id', userId).eq('date', localDate).maybeSingle(),
  ]);

  // Today's routines, each carrying whatever the user has already said about it,
  // so a notification never asks about something already answered in the app.
  const answered = new Map((events.data ?? []).map((row) => [row.routine_id as string, (row.note as string | null) ?? (row.status as string)]));

  // Placed against the clock by the same code as the home brief. The push used
  // to send the whole day's list and let the model pick, under a prompt written
  // for a single placed routine, so it picked badly.
  const placed = routinesToday({
    state: 'ready',
    routines: (routines.data ?? []).map((row): Routine => ({
      id: String(row.id), title: String(row.title), kind: (row.kind as RoutineKind) ?? 'other',
      atTime: String(row.at_time).slice(0, 5), days: (row.days as number[] | null) ?? [0, 1, 2, 3, 4, 5, 6],
      active: true, flexible: row.flexible === true, archivedAt: null,
    })),
    events: (events.data ?? []).map((row): RoutineEvent => ({
      id: '', routineId: row.routine_id as string, title: '', localDate, status: row.status as RoutineStatus, note: (row.note as string | null) ?? null,
    })),
  }, now, timeZone);
  const current = currentRoutine(placed);
  const routine: BriefRoutine | null = current
    ? {
      title: current.routine.title.slice(0, 60), kind: current.routine.kind, at: clockLabel(current.routine.atTime),
      minutesAway: current.minutesAway, state: routineState(current), flexible: current.routine.flexible,
      answered: current.event ? current.event.note ?? current.event.status : null,
    }
    : null;
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const monthPrefix = localDate.slice(0, 7);
  let spending: NotificationContext['spending'] = null;
  // Money moved into an FD or a SIP is saved, not spent.
  const expenses = (transactions.data ?? []).filter((row) => !isInvestmentCategory(row.category));
  if (expenses.length) {
    // Report the most common currency only, so amounts are never mixed.
    const counts = new Map<string, number>();
    expenses.forEach((row) => counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1));
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let today = 0;
    let month = 0;
    let todayCount = 0;
    for (const row of expenses) {
      if (row.currency !== currency) continue;
      const date = localClock(new Date(row.occurred_at), timeZone).date;
      if (date.startsWith(monthPrefix)) month += Number(row.amount);
      if (date === localDate) {
        today += Number(row.amount);
        todayCount += 1;
      }
    }
    spending = { currency, today: Math.round(today), month: Math.round(month), todayCount };
  }

  const name = profile.data?.preferred_name?.trim().split(/\s+/)[0] ?? null;
  return {
    slot,
    localDate,
    localTime,
    name,
    fitness: persona.data?.persona ? persona.data.persona.trim().slice(0, 600) : null,
    routines: (routines.data ?? [])
      .filter((routine) => (routine.days as number[] | null)?.includes(weekday) ?? true)
      .map((routine) => ({ title: String(routine.title).slice(0, 60), at: String(routine.at_time).slice(0, 5), status: answered.get(routine.id as string) ?? null })),
    routine,
    missedCount: missedRoutines(placed).length,
    spending,
    stepsToday: typeof steps.data?.steps === 'number' ? steps.data.steps : null,
    socialLine: social.error ? '' : socialReminder((social.data ?? []).map((row) => ({
      plannedFor: row.planned_for as string,
      status: row.status as SocialStatus,
      format: row.format as SocialFormat,
      mediaPath: (row.media_path as string | null) ?? null,
    })), localDate),
  };
}
