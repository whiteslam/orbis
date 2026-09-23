'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return error || typeof userId !== 'string' ? null : { supabase, userId };
}

export async function addContextNoteAction(noteInput: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to save this note.' };
  if (typeof noteInput !== 'string') return { success: false, message: 'Enter a note.' };
  const note = noteInput.trim().slice(0, 1000);
  if (!note) return { success: false, message: 'Enter a note.' };
  const { error } = await auth.supabase.from('user_context_notes').insert({ user_id: auth.userId, note });
  if (error) return { success: false, message: 'Note could not be saved. Check that the Orbis Memory migration is applied.' };
  revalidatePath('/');
  return { success: true, message: 'Note saved.' };
}

export async function deleteContextNoteAction(id: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to remove this note.' };
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { success: false, message: 'This note is invalid.' };
  const { data, error } = await auth.supabase.from('user_context_notes').delete().eq('id', id).eq('user_id', auth.userId).select('id').maybeSingle();
  if (error || !data) return { success: false, message: 'Note could not be removed.' };
  revalidatePath('/');
  return { success: true, message: 'Note removed.' };
}
