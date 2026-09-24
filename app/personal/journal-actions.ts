'use server';

import { revalidatePath } from 'next/cache';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { createClient } from '@/lib/supabase/server';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today && value >= '2000-01-01';
}

export async function saveJournalEntryAction(input: { date: string; mood: number; body: string; tags: string[] }) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to save your journal.' };
  if (!input || typeof input !== 'object' || !validDate(input.date)) return { success: false, message: 'Choose a valid date (today or earlier).' };
  if (!Number.isInteger(input.mood) || input.mood < 1 || input.mood > 5) return { success: false, message: 'Pick how you’re feeling.' };
  if (typeof input.body !== 'string' || input.body.length > 4000) return { success: false, message: 'Keep the entry under 4,000 characters.' };
  if (!Array.isArray(input.tags)) return { success: false, message: 'Tags are invalid.' };

  const tags = Array.from(new Set(input.tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 24))
    .filter(Boolean))).slice(0, 8);

  const { error } = await auth.supabase.from('journal_entries').upsert(
    { user_id: auth.userId, entry_date: input.date, mood: input.mood, body: input.body.trim(), tags },
    { onConflict: 'user_id,entry_date' },
  );
  if (error) {
    const missing = ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '');
    return { success: false, message: missing ? 'Apply the profile/journal migration in Supabase to start journaling.' : 'Your entry could not be saved. Try again.' };
  }
  revalidatePath('/');
  return { success: true, message: 'Journal saved.' };
}

export async function deleteJournalEntryAction(date: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to update your journal.' };
  if (!validDate(date)) return { success: false, message: 'This entry is invalid.' };
  const { error } = await auth.supabase.from('journal_entries').delete().eq('user_id', auth.userId).eq('entry_date', date);
  if (error) return { success: false, message: 'The entry could not be deleted.' };
  revalidatePath('/');
  return { success: true, message: 'Entry deleted.' };
}
