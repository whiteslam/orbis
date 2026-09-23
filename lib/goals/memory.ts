import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type ContextNote = { id: string; note: string; updatedAt: string };

export async function getContextNotes(userId: string): Promise<{ ready: boolean; notes: ContextNote[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('user_context_notes').select('id,note,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(30);
  if (error) return { ready: !['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? ''), notes: [] };
  return { ready: true, notes: (data ?? []).map((item) => ({ id: item.id, note: item.note, updatedAt: item.updated_at })) };
}
