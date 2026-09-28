import 'server-only';

import type { AiConsent } from '@/lib/ai/consent';
import { createAdminClient } from '@/lib/supabase/admin';

const OFF: AiConsent = { aiEnabled: false, aiConsentedAt: null };

/**
 * The person's AI switch and consent stamp, read with the admin client so the
 * router can check it from anywhere, including the notification cron where
 * there is no signed-in session.
 *
 * Fails closed: no row, a missing column (the migration not yet applied) or a
 * read error all count as "off", so nothing is sent until a row says it may be.
 */
export async function getAiConsent(userId: string): Promise<AiConsent> {
  try {
    const { data, error } = await createAdminClient()
      .from('ai_preferences')
      .select('ai_enabled,ai_consented_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('Reading AI consent failed', error);
      return OFF;
    }
    if (!data) return OFF;
    return {
      aiEnabled: data.ai_enabled === true,
      aiConsentedAt: typeof data.ai_consented_at === 'string' ? data.ai_consented_at : null,
    };
  } catch (error) {
    console.error('Reading AI consent failed', error);
    return OFF;
  }
}
