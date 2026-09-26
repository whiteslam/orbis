import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { localClock, type Slot } from '@/lib/notifications/schedule';

type Admin = ReturnType<typeof createAdminClient>;

export type NotificationContext = {
  slot: Slot;
  localDate: string;
  localTime: string;
  name: string | null;
  fitness: string | null;
  routines: Array<{ title: string; at: string; status: string | null }>;
  spending: { currency: string; today: number; month: number; todayCount: number } | null;
  stepsToday: number | null;
};

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Small, trimmed facts about the user's day. Runs from the scheduler (no browser session), so it reads with the
// service role and every query is filtered by user_id. Missing tables or errors simply leave a section empty.
export async function buildNotificationContext(admin: Admin, userId: string, slot: Slot, now: Date, timeZone: string): Promise<NotificationContext> {
  const clock = localClock(now, timeZone);
  const localDate = clock.date;
  const localTime = `${String(Math.floor(clock.minutes / 60)).padStart(2, '0')}:${String(clock.minutes % 60).padStart(2, '0')}`;

  const [profile, persona, routines, events, transactions, steps] = await Promise.all([
    admin.from('user_personal_profiles').select('preferred_name').eq('user_id', userId).maybeSingle(),
    admin.from('user_fitness_personas').select('persona').eq('user_id', userId).maybeSingle(),
    admin.from('routines').select('id,title,at_time,days').eq('user_id', userId).eq('active', true).order('at_time').limit(20),
    admin.from('routine_events').select('routine_id,status,note').eq('user_id', userId).eq('local_date', localDate).limit(20),
    admin.from('transactions').select('amount,currency,occurred_at').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', `${shift(localDate, -32)}T00:00:00Z`).limit(500),
    admin.from('health_daily_steps').select('steps').eq('user_id', userId).eq('date', localDate).maybeSingle(),
  ]);

  // Today's routines, each carrying whatever the user has already said about it,
  // so a notification never asks about something already answered in the app.
  const answered = new Map((events.data ?? []).map((row) => [row.routine_id as string, (row.note as string | null) ?? (row.status as string)]));
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const monthPrefix = localDate.slice(0, 7);
  let spending: NotificationContext['spending'] = null;
  const expenses = transactions.data ?? [];
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
    spending,
    stepsToday: typeof steps.data?.steps === 'number' ? steps.data.steps : null,
  };
}
