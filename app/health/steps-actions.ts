'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';

const MAX_DAYS = 7_500;
const CHUNK = 1_000;
const SOURCE = 'apple_health_export';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const missingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

function validDate(value: unknown, latest: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value && time >= Date.UTC(2007, 0, 1) && time <= latest;
}

export async function importAppleHealthStepsAction(input: unknown) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to import your step data.', dayCount: 0 };
  if (!isRecord(input) || !Array.isArray(input.days) || typeof input.fileName !== 'string' || !Number.isInteger(input.recordCount) || (input.recordCount as number) < 0) return { success: false, message: 'The imported step data is invalid.', dayCount: 0 };
  if (!input.days.length) return { success: false, message: 'No step records were found in this export.', dayCount: 0 };
  if (input.days.length > MAX_DAYS) return { success: false, message: 'This export has more days than Orbis can import at once.', dayCount: 0 };

  // Exports use the phone's local date, which can be a day ahead of UTC.
  const latest = Date.now() + 2 * 86_400_000;
  const seen = new Set<string>();
  const days: { date: string; steps: number }[] = [];
  for (const day of input.days) {
    if (!isRecord(day) || !validDate(day.date, latest) || !Number.isInteger(day.steps) || (day.steps as number) < 0 || (day.steps as number) > 200_000 || seen.has(day.date)) return { success: false, message: 'The imported step data is invalid.', dayCount: 0 };
    seen.add(day.date);
    days.push({ date: day.date, steps: day.steps as number });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const fileName = input.fileName.trim().slice(0, 200) || 'export.zip';
  const { data: batch, error: batchError } = await auth.supabase
    .from('health_import_batches')
    .insert({ user_id: auth.userId, source: SOURCE, file_name: fileName, record_count: input.recordCount, day_count: days.length, first_date: days[0].date, last_date: days.at(-1)!.date })
    .select('id')
    .single();
  if (batchError || !batch) return { success: false, message: missingTable(batchError?.code) ? 'Apply the Health steps migration before importing.' : 'Step data could not be saved. Please try again.', dayCount: 0 };

  const updatedAt = new Date().toISOString();
  for (let i = 0; i < days.length; i += CHUNK) {
    const rows = days.slice(i, i + CHUNK).map((day) => ({ user_id: auth.userId, date: day.date, steps: day.steps, source: SOURCE, import_batch_id: batch.id, updated_at: updatedAt }));
    const { error } = await auth.supabase.from('health_daily_steps').upsert(rows, { onConflict: 'user_id,date,source' });
    if (error) {
      revalidatePath('/');
      return { success: false, message: missingTable(error.code) ? 'Apply the Health steps migration before importing.' : 'Some step data could not be saved. Import the file again to finish.', dayCount: i };
    }
  }

  revalidatePath('/');
  return { success: true, message: `${days.length.toLocaleString('en-IN')} days of steps imported.`, dayCount: days.length };
}

export async function deleteHealthStepsAction() {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to delete your step data.' };
  const steps = await auth.supabase.from('health_daily_steps').delete().eq('user_id', auth.userId);
  const batches = steps.error ? null : await auth.supabase.from('health_import_batches').delete().eq('user_id', auth.userId);
  if (steps.error || batches?.error) return { success: false, message: 'Step data could not be deleted. Please try again.' };
  revalidatePath('/');
  return { success: true, message: 'Your step data has been deleted.' };
}
