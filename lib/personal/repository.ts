import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type FitnessPersonaState = 'ready' | 'setup' | 'unavailable';
export type FitnessPersonaSummary = { state: FitnessPersonaState; persona: string | null };

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
