import 'server-only';

import { aiAllowed } from '@/lib/ai/consent';
import { getAiConsent } from '@/lib/ai/consent-store';
import { routerAvailable, type Sensitivity } from '@/lib/ai/router';

/**
 * Asked by every AI action before it spends anything: a daily credit, a
 * database read for context, or a request.
 *
 * 'off' means the person has not turned AI on (show AI_OFF_MESSAGE);
 * 'unavailable' means no model that may see this kind of data can run right
 * now. The router checks consent again itself, so this is about not charging
 * quota for a request that could never be sent, not the only line of defence.
 */
export async function aiBlocked(userId: string, sensitivity: Sensitivity): Promise<'off' | 'unavailable' | null> {
  if (!aiAllowed(await getAiConsent(userId))) return 'off';
  if (!(await routerAvailable(sensitivity))) return 'unavailable';
  return null;
}
