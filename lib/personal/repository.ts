import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type PersonalDataState = 'ready' | 'setup' | 'unavailable';
export type FitnessPersonaState = PersonalDataState;
export type FitnessPersonaSummary = { state: FitnessPersonaState; persona: string | null };
export type PersonalProfile = { preferredName: string; role: string; aboutMe: string };
export type PersonalProfileSummary = { state: PersonalDataState; profile: PersonalProfile | null };

export async function getFitnessPersona(userId: string): Promise<FitnessPersonaSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_fitness_personas')
    .select('persona')
    .eq('user_id', userId)
    .maybeSingle();

  if (!error) return { state: 'ready', persona: data?.persona ?? null };
  if (['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '')) return { state: 'setup', persona: null };
  return { state: 'unavailable', persona: null };
}

export async function getPersonalProfile(userId: string): Promise<PersonalProfileSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_personal_profiles')
    .select('preferred_name,role,about_me')
    .eq('user_id', userId)
    .maybeSingle();

  if (!error) {
    return {
      state: 'ready',
      profile: data ? {
        preferredName: data.preferred_name ?? '',
        role: data.role ?? '',
        aboutMe: data.about_me ?? '',
      } : null,
    };
  }
  if (['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '')) return { state: 'setup', profile: null };
  return { state: 'unavailable', profile: null };
}

export type HomeLocation = { state: PersonalDataState; city: string | null };

export async function getHomeLocation(userId: string): Promise<HomeLocation> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('user_locations').select('city').eq('user_id', userId).maybeSingle();
  if (!error) return { state: 'ready', city: data?.city ?? null };
  if (['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '')) return { state: 'setup', city: null };
  return { state: 'unavailable', city: null };
}
