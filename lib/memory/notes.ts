import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';

export type ContextNote = { id: string; note: string; updatedAt: string };

export async function getContextNotes(userId: string): Promise<{ ready: boolean; notes: ContextNote[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('user_context_notes').select('id,note,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(30);
  if (error) return { ready: !isMissingTable(error), notes: [] };
  return { ready: true, notes: (data ?? []).map((item) => ({ id: item.id, note: item.note, updatedAt: item.updated_at })) };
}
