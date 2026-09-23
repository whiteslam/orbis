'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function userClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return error || typeof userId !== 'string' ? null : { supabase, userId };
}

function validId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export async function createGoalAction(input: { title: string; target: string; current: string; unit: string; dueDate: string }) {
  const auth = await userClient();
  if (!auth) return { success: false, message: 'Sign in again to save this goal.' };
  if (!input || typeof input.title !== 'string' || typeof input.target !== 'string' || typeof input.current !== 'string' || typeof input.unit !== 'string' || typeof input.dueDate !== 'string') return { success: false, message: 'Enter valid goal details.' };
  const title = input.title.trim().slice(0, 100);
  const target = Number(input.target);
  const current = Number(input.current || 0);
  const unit = input.unit.trim().slice(0, 24);
  const dueDate = input.dueDate || null;
  if (!title || !Number.isFinite(target) || target <= 0 || target > 1_000_000_000 || !Number.isFinite(current) || current < 0 || current > target) return { success: false, message: 'Set a title and a target greater than your current progress.' };
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { success: false, message: 'Choose a valid target date.' };
  const { error } = await auth.supabase.from('goals').insert({ user_id: auth.userId, title, current_value: current, target_value: target, unit, due_date: dueDate });
  if (error) return { success: false, message: 'Goal could not be saved. Check that the Goals and Habits migration is applied.' };
  revalidatePath('/');
  return { success: true, message: 'Goal added.' };
}

export async function updateGoalProgressAction(id: string, currentValue: string) {
  const auth = await userClient();
  if (!auth) return { success: false, message: 'Sign in again to update this goal.' };
  if (typeof id !== 'string' || !validId(id) || typeof currentValue !== 'string') return { success: false, message: 'This goal update is invalid.' };
  const current = Number(currentValue);
  if (!Number.isFinite(current) || current < 0 || current > 1_000_000_000) return { success: false, message: 'Enter a valid progress value.' };
  const { data: goal, error: readError } = await auth.supabase.from('goals').select('target_value').eq('id', id).eq('user_id', auth.userId).maybeSingle();
  if (readError || !goal) return { success: false, message: 'Goal not found.' };
  if (current > Number(goal.target_value)) return { success: false, message: 'Progress cannot be greater than the goal target.' };
  const { error } = await auth.supabase.from('goals').update({ current_value: current, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', auth.userId);
  if (error) return { success: false, message: 'Progress could not be updated.' };
  revalidatePath('/');
  return { success: true, message: 'Progress updated.' };
}

export async function createHabitAction(titleInput: string) {
  const auth = await userClient();
  if (!auth) return { success: false, message: 'Sign in again to save this habit.' };
  if (typeof titleInput !== 'string') return { success: false, message: 'Enter a habit name.' };
  const title = titleInput.trim().slice(0, 100);
  if (!title) return { success: false, message: 'Enter a habit name.' };
  const { error } = await auth.supabase.from('habits').insert({ user_id: auth.userId, title });
  if (error) return { success: false, message: 'Habit could not be saved. Check that the Goals and Habits migration is applied.' };
  revalidatePath('/');
  return { success: true, message: 'Habit added.' };
}

export async function checkInHabitAction(id: string, date: string) {
  const auth = await userClient();
  if (!auth) return { success: false, message: 'Sign in again to check in.' };
  if (typeof id !== 'string' || !validId(id) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, message: 'This habit check-in is invalid.' };
  const { data: habit, error: habitError } = await auth.supabase.from('habits').select('id').eq('id', id).eq('user_id', auth.userId).is('archived_at', null).maybeSingle();
  if (habitError || !habit) return { success: false, message: 'Habit not found.' };
  const { error } = await auth.supabase.from('habit_checkins').upsert({ user_id: auth.userId, habit_id: id, checked_on: date }, { onConflict: 'habit_id,checked_on', ignoreDuplicates: true });
  if (error) return { success: false, message: 'Check-in could not be saved.' };
  revalidatePath('/');
  return { success: true, message: 'Habit checked in for today.' };
}
