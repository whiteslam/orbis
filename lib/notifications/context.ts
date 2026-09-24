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
  habits: Array<{ title: string; done: boolean }>;
  goals: Array<{ title: string; percent: number }>;
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

  const [profile, persona, habits, checkins, goals, transactions, steps] = await Promise.all([
    admin.from('user_personal_profiles').select('preferred_name').eq('user_id', userId).maybeSingle(),
    admin.from('user_fitness_personas').select('persona').eq('user_id', userId).maybeSingle(),
    admin.from('habits').select('id,title').eq('user_id', userId).is('archived_at', null).order('created_at').limit(12),
    admin.from('habit_checkins').select('habit_id').eq('user_id', userId).eq('checked_on', localDate),
    admin.from('goals').select('title,current_value,target_value').eq('user_id', userId).order('created_at', { ascending: false }).limit(6),
    admin.from('transactions').select('amount,currency,occurred_at').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', `${shift(localDate, -32)}T00:00:00Z`).limit(500),
    admin.from('health_daily_steps').select('steps').eq('user_id', userId).eq('date', localDate).maybeSingle(),
  ]);

  const done = new Set((checkins.data ?? []).map((row) => row.habit_id));
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
    habits: (habits.data ?? []).map((habit) => ({ title: habit.title.slice(0, 60), done: done.has(habit.id) })),
    goals: (goals.data ?? []).map((goal) => ({ title: goal.title.slice(0, 60), percent: Math.round((Number(goal.current_value) / Number(goal.target_value)) * 100) })),
    spending,
    stepsToday: typeof steps.data?.steps === 'number' ? steps.data.steps : null,
  };
}
