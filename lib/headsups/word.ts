import 'server-only';

import { routeJson } from '@/lib/ai/router';
import { parseWording, wordingPrompt } from '@/lib/headsups/prompt';
import type { Finding, Wording } from '@/lib/headsups/types';

const TIMEOUT_MS = 10_000;

/**
 * A heads-up's words. The model sees one finding's numbers and Orbis's own
 * wording, nothing else, and only through the router (consent, then may_train
 * = false providers for 'personal'). Anything but clean JSON keeps Orbis's words.
 */
export async function wordFinding(userId: string, finding: Finding, aiBudgetLeft: boolean): Promise<Wording & { wordedBy: 'ai' | 'rules' }> {
  if (!aiBudgetLeft) return { ...finding.fallback, wordedBy: 'rules' };
  const { system, user } = wordingPrompt(finding);
  const result = await routeJson({ userId, feature: 'headsups', sensitivity: 'personal', system, user, maxTokens: 300, temperature: 0.3, timeoutMs: TIMEOUT_MS, accept: (text) => parseWording(text) !== null });
  const wording = result ? parseWording(result.text) : null;
  return wording ? { ...wording, wordedBy: 'ai' } : { ...finding.fallback, wordedBy: 'rules' };
}
