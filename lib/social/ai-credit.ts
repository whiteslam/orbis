import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export const DAILY_DRAFT_LIMIT = 10;
// A second Generate within this many seconds is a double click, not a new request.
const DRAFT_GAP_SECONDS = 20;

/** Spends one of today's AI requests (drafts, promotion posts, new images); a message when none can be spent. */
export async function claimSocialAiCredit(userId: string): Promise<string | null> {
  try {
    const { data: verdict, error } = await createAdminClient().rpc('consume_social_ai_request', {
      p_user_id: userId,
      p_daily_limit: DAILY_DRAFT_LIMIT,
      p_gap_seconds: DRAFT_GAP_SECONDS,
    });
    if (error) {
      console.error('consume_social_ai_request failed', error);
      return 'AI drafts aren’t available right now. Try again later.';
    }
    if (verdict === 'busy') return 'Already drafting. Give it a moment.';
    if (verdict !== 'ok') return `You have used today’s ${DAILY_DRAFT_LIMIT} AI drafts. Try again tomorrow.`;
    return null;
  } catch {
    return 'AI drafts are not available right now. Try again later.';
  }
}

