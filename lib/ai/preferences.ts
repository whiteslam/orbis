import 'server-only';

import { routerAvailable } from '@/lib/ai/router';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';

/**
 * What the user has agreed to send to an AI provider on their behalf.
 *
 * 'setup' means the migration has not been applied, which is treated exactly
 * like "off": nothing leaves the device until there is a row saying it may.
 */
export type AiPreferences = {
  state: 'ready' | 'setup' | 'unavailable';
  /** The one switch for every AI feature. Off until the person turns it on. */
  aiEnabled: boolean;
  /** When they first agreed to the disclosure; kept after AI is turned off again. */
  aiConsentedAt: string | null;
  homeBriefEnabled: boolean;
  /** Whether a model that may see personal data can run right now, so the settings can explain themselves. */
  configured: boolean;
  /** Whether adding a health document sends its text out to be indexed; see lib/health-docs/embeddings.ts. */
  externalDocumentIndexing: boolean;
};

// Postgres's "undefined column": the consent migration has not been applied yet.
const UNDEFINED_COLUMN = '42703';

const SAVE_FAILED = 'That setting could not be saved. Try again shortly.';

export function externalDocumentIndexing() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim()) && process.env.ORBIS_ALLOW_EXTERNAL_EMBEDDINGS?.trim() === 'true';
}

export async function getAiPreferences(userId: string): Promise<AiPreferences> {
  const base = { aiEnabled: false, aiConsentedAt: null, homeBriefEnabled: false, externalDocumentIndexing: externalDocumentIndexing() };
  const [configured, row] = await Promise.all([
    routerAvailable('personal'),
    (async () => {
      const supabase = await createClient();
      return supabase
        .from('ai_preferences')
        .select('home_brief_enabled,ai_enabled,ai_consented_at')
        .eq('user_id', userId)
        .maybeSingle();
    })().catch(() => null),
  ]);
  if (!row) return { ...base, state: 'unavailable', configured };
  const { data, error } = row;
  if (error) {
    console.error('Reading AI preferences failed', error);
    return { ...base, state: isMissingTable(error.code) || error.code === UNDEFINED_COLUMN ? 'setup' : 'unavailable', configured };
  }
  return {
    ...base,
    state: 'ready',
    aiEnabled: data?.ai_enabled === true,
    aiConsentedAt: typeof data?.ai_consented_at === 'string' ? data.ai_consented_at : null,
    homeBriefEnabled: data?.home_brief_enabled === true,
    configured,
  };
}

type SaveResult = { ok: true } | { ok: false; message: string };

function saveFailure(error: { code?: string }): SaveResult {
  console.error('Saving AI preferences failed', error);
  return { ok: false, message: isMissingTable(error.code) || error.code === UNDEFINED_COLUMN ? 'This setting isn’t available right now.' : SAVE_FAILED };
}

export async function setHomeBriefEnabled(userId: string, enabled: boolean): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('ai_preferences')
      .upsert({ user_id: userId, home_brief_enabled: enabled, updated_at: new Date().toISOString() });
    if (error) return saveFailure(error);
    return { ok: true };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}

/**
 * The one AI switch. Turning it on the first time stamps ai_consented_at: that
 * is the record that the person saw the disclosure and agreed. Turning it off
 * keeps the stamp (it records a past agreement) but the router stops at the
 * switch, so nothing more is sent.
 */
export async function setAiEnabled(userId: string, enabled: boolean): Promise<SaveResult> {
  try {
    const supabase = await createClient();
    const now = new Date().toISOString();
    let consentedAt: string | null = null;
    if (enabled) {
      const { data, error } = await supabase.from('ai_preferences').select('ai_consented_at').eq('user_id', userId).maybeSingle();
      if (error) return saveFailure(error);
      consentedAt = typeof data?.ai_consented_at === 'string' ? data.ai_consented_at : now;
    }
    const { error } = await supabase
      .from('ai_preferences')
      .upsert({ user_id: userId, ai_enabled: enabled, ...(consentedAt ? { ai_consented_at: consentedAt } : {}), updated_at: now });
    if (error) return saveFailure(error);
    return { ok: true };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}
