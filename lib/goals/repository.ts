import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { GoalsSummary } from '@/lib/goals/types';

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateOffset(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export async function getGoalsSummary(userId: string): Promise<GoalsSummary> {
  const supabase = await createClient();
  const today = localDate(new Date());
  const [{ data: goals, error: goalsError }, { data: habits, error: habitsError }] = await Promise.all([
    supabase.from('goals').select('id,title,current_value,target_value,unit,due_date').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    supabase.from('habits').select('id,title').eq('user_id', userId).is('archived_at', null).order('created_at', { ascending: false }).limit(30),
  ]);

  if (goalsError || habitsError) {
    const errors = [goalsError, habitsError];
    const databaseReady = !errors.some((error) => error?.code === 'PGRST205' || error?.code === 'PGRST204' || error?.code === '42P01');
    return { databaseReady, goals: [], habits: [] };
  }

  const habitIds = (habits ?? []).map((habit) => habit.id);
  const { data: checkins, error: checkinError } = habitIds.length
    ? await supabase.from('habit_checkins').select('habit_id,checked_on').eq('user_id', userId).in('habit_id', habitIds).gte('checked_on', dateOffset(today, -29)).lte('checked_on', today)
    : { data: [], error: null };
  if (checkinError) return { databaseReady: true, goals: [], habits: [] };

  const datesByHabit = new Map<string, Set<string>>();
  for (const checkin of checkins ?? []) {
    const dates = datesByHabit.get(checkin.habit_id) ?? new Set<string>();
    dates.add(checkin.checked_on);
    datesByHabit.set(checkin.habit_id, dates);
  }

  return {
    databaseReady: true,
    goals: (goals ?? []).map((goal) => ({
      id: goal.id,
      title: goal.title,
      current: Number(goal.current_value),
      target: Number(goal.target_value),
      unit: goal.unit,
      dueDate: goal.due_date,
    })),
    habits: (habits ?? []).map((habit) => {
      const dates = datesByHabit.get(habit.id) ?? new Set<string>();
      let streak = 0;
      let day = dates.has(today) ? today : dateOffset(today, -1);
      while (dates.has(day)) {
        streak += 1;
        day = dateOffset(day, -1);
      }
      return { id: habit.id, title: habit.title, checkedToday: dates.has(today), streak };
    }),
  };
}
