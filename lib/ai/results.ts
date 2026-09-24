import 'server-only';

import type { AiFeature, AiResultStamp, SavedAiResult } from '@/lib/ai/saved';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Older results stay readable for a while, but a user should not accumulate
// unbounded AI history without asking for it.
const KEEP_PER_FEATURE = 10;

/**
 * Stores a generated result so the screen can show it again after a reload, and
 * returns its row so the caller can offer a delete. Saving must never change what
 * the user just received, so every failure here (including the migration not being
 * applied yet) is swallowed and reported as null.
 */
export async function saveAiResult(input: {
  userId: string;
  feature: AiFeature;
  result: unknown;
  model: string;
  title?: string | null;
  context?: unknown;
}): Promise<AiResultStamp | null> {
  try {
    const admin = createAdminClient();
    const { data: inserted, error } = await admin
      .from('ai_results')
      .insert({
        user_id: input.userId,
        feature: input.feature,
        title: input.title ? input.title.slice(0, 160) : null,
        context: input.context ?? {},
        result: input.result,
        model: input.model.slice(0, 120),
      })
      .select('id,created_at')
      .single();
    if (error || !inserted) return null;
    const { data: keep } = await admin
      .from('ai_results')
      .select('created_at')
      .eq('user_id', input.userId)
      .eq('feature', input.feature)
      .order('created_at', { ascending: false })
      .range(KEEP_PER_FEATURE - 1, KEEP_PER_FEATURE - 1);
    const cutoff = keep?.[0]?.created_at;
    if (cutoff) {
      await admin.from('ai_results').delete().eq('user_id', input.userId).eq('feature', input.feature).lt('created_at', cutoff);
    }
    return { id: inserted.id, createdAt: inserted.created_at };
  } catch {
    // A saved copy is a convenience; generation already succeeded.
    return null;
  }
}

/** The most recent saved result for a feature, or null if there is none yet. */
export async function getLatestAiResult<TResult, TContext = Record<string, unknown>>(
  userId: string,
  feature: AiFeature,
): Promise<SavedAiResult<TResult, TContext> | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ai_results')
      .select('id,title,context,result,created_at')
      .eq('user_id', userId)
      .eq('feature', feature)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      title: data.title,
      context: (data.context ?? {}) as TContext,
      result: data.result as TResult,
      createdAt: data.created_at,
    };
  } catch {
    // Before the migration is applied the screen simply starts empty.
    return null;
  }
}

/** Removes one saved result. Returns false when it is not the user's row. */
export async function deleteAiResult(userId: string, id: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('ai_results').delete().eq('id', id).eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}
