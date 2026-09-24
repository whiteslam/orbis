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

export async function saveFitnessPersonaAction(personaInput: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to save your persona.' };
  if (typeof personaInput !== 'string') return { success: false, message: 'Enter your persona before saving.' };
  const persona = personaInput.trim();
  if (!persona) return { success: false, message: 'Enter your persona before saving.' };
  if (persona.length > 3000) return { success: false, message: 'Keep your persona under 3,000 characters.' };

  const { error } = await auth.supabase.from('user_fitness_personas').upsert(
    { user_id: auth.userId, persona, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) return { success: false, message: 'Persona could not be saved. Apply the Fitness Persona migration in Supabase.' };
  revalidatePath('/');
  return { success: true, message: 'Fitness persona saved privately to your account.' };
}

export async function deleteFitnessPersonaAction() {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to remove your persona.' };

  const { error } = await auth.supabase.from('user_fitness_personas').delete().eq('user_id', auth.userId);
  if (error) return { success: false, message: 'Persona could not be removed.' };
  revalidatePath('/');
  return { success: true, message: 'Saved persona removed. The starter draft remains available to edit.' };
}

export async function savePersonalProfileAction(value: unknown) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to save your profile.' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { success: false, message: 'Review your profile details and try again.' };

  const input = value as Record<string, unknown>;
  if (typeof input.preferredName !== 'string' || typeof input.role !== 'string' || typeof input.aboutMe !== 'string') return { success: false, message: 'Review your profile details and try again.' };
  const preferredName = input.preferredName.trim();
  const role = input.role.trim();
  const aboutMe = input.aboutMe.trim();
  if (preferredName.length > 80) return { success: false, message: 'Keep your preferred name under 80 characters.' };
  if (role.length > 120) return { success: false, message: 'Keep your work or role under 120 characters.' };
  if (aboutMe.length > 3000) return { success: false, message: 'Keep “More about me” under 3,000 characters.' };
  if (!preferredName && !role && !aboutMe) return { success: false, message: 'Add at least one detail before saving.' };

  const { error } = await auth.supabase.from('user_personal_profiles').upsert(
    {
      user_id: auth.userId,
      preferred_name: preferredName || null,
      role: role || null,
      about_me: aboutMe,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { success: false, message: 'Profile could not be saved. Apply the Personal Profile migration in Supabase.' };
  revalidatePath('/');
  return { success: true, message: 'Profile saved privately to your account.' };
}

export async function deletePersonalProfileAction() {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to remove your profile.' };

  const { error } = await auth.supabase.from('user_personal_profiles').delete().eq('user_id', auth.userId);
  if (error) return { success: false, message: 'Profile could not be removed.' };
  revalidatePath('/');
  return { success: true, message: 'Personal profile removed.' };
}
