import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * What the user has agreed to send to the model provider on their behalf.
 *
 * 'setup' means the migration has not been applied, which is treated exactly
 * like "off": nothing leaves the device until there is a row saying it may.
 */
export type AiPreferences = {
  state: 'ready' | 'setup' | 'unavailable';
  homeBriefEnabled: boolean;
  /** False when the server has no OpenRouter key, so the toggle can explain itself. */
  configured: boolean;
};

const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

export async function getAiPreferences(userId: string): Promise<AiPreferences> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ai_preferences')
      .select('home_brief_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', homeBriefEnabled: false, configured };
    return { state: 'ready', homeBriefEnabled: data?.home_brief_enabled === true, configured };
  } catch {
    return { state: 'unavailable', homeBriefEnabled: false, configured };
  }
}

export async function setHomeBriefEnabled(userId: string, enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('ai_preferences')
      .upsert({ user_id: userId, home_brief_enabled: enabled, updated_at: new Date().toISOString() });
    if (error) {
      return { ok: false, message: isMissingTable(error.code) ? 'Apply the home brief migration in Supabase, then try again.' : 'That setting could not be saved. Try again shortly.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'That setting could not be saved. Try again shortly.' };
  }
}
