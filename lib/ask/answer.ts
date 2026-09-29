import 'server-only';

import { buildAskContext } from '@/lib/ask/context';
import { askPayload, askSystem } from '@/lib/ask/prompt';
import { keepCitations, type AskSource, type Citation } from '@/lib/ask/select';
import { AI_OFF_MESSAGE } from '@/lib/ai/consent';
import { aiBlocked } from '@/lib/ai/gate';
import { routeJson } from '@/lib/ai/router';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TalkTurn } from '@/lib/voice/talk';

export const DAILY_ASK_LIMIT = 20;
const MAX_INPUT_BYTES = 60_000;

export const NO_MODEL_MESSAGE = 'No private AI model is available right now, so your records stayed put. Try again later.';

export type AskResult = { success: boolean; message: string; answer?: string; citations?: Citation[] };

/**
 * Consent first, then whether a model that may see personal data can run at
 * all. Callers check this before anything is read, sent or spent: the spoken
 * path checks it before a recording leaves the server.
 */
export async function askBlockedMessage(userId: string): Promise<string | null> {
  const blocked = await aiBlocked(userId, 'personal');
  if (blocked === 'off') return AI_OFF_MESSAGE;
  return blocked ? NO_MODEL_MESSAGE : null;
}

/**
 * Answers a checked question from the user's own data, typed or spoken.
 *
 * Only the given sources are read, and the request is always 'personal', so it
 * can only reach a model that will not train on it; when no such model is
 * available the user is told so rather than silently downgraded. Typed and
 * spoken questions share the one daily allowance.
 */
export async function answerFromRecords(input: {
  userId: string;
  question: string;
  sources: AskSource[];
  earlier?: TalkTurn[];
  spokenLanguage?: string;
}): Promise<AskResult> {
  const { userId, question, sources } = input;
  const blocked = await askBlockedMessage(userId);
  if (blocked) return { success: false, message: blocked };

  let context: Awaited<ReturnType<typeof buildAskContext>>;
  try {
    context = await buildAskContext(userId, question, sources);
  } catch {
    return { success: false, message: 'Your records could not be loaded. Try again.' };
  }
  if (!context.used.length) return { success: false, message: 'There is nothing in the last six months of what you chose to look at yet.' };

  const user = askPayload(question, context.data, input.earlier);
  if (Buffer.byteLength(user, 'utf8') > MAX_INPUT_BYTES) return { success: false, message: 'That is more data than Orbis can read at once. Untick a source and try again.' };

  try {
    const { data: allowed, error } = await createAdminClient().rpc('consume_ask_orbis_request', { p_user_id: userId, p_daily_limit: DAILY_ASK_LIMIT });
    if (error) return { success: false, message: 'Ask Orbis is not set up yet. Apply the Ask Orbis migration in Supabase.' };
    if (!allowed) return { success: false, message: `You have asked ${DAILY_ASK_LIMIT} questions today. Try again tomorrow.` };
  } catch {
    return { success: false, message: 'Ask Orbis is not available right now. Try again later.' };
  }

  const system = askSystem({ spokenLanguage: input.spokenLanguage });
  const result = await routeJson({ userId, feature: input.spokenLanguage ? 'talk_orbis' : 'ask_orbis', sensitivity: 'personal', system, user, maxTokens: 700, temperature: 0.2, timeoutMs: 25_000 });
  if (!result) return { success: false, message: NO_MODEL_MESSAGE };

  let parsed: { answer?: unknown; citations?: unknown };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { success: false, message: 'Orbis couldn’t form an answer. Try rewording the question.' };
  }
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim().slice(0, 1200) : '';
  if (!answer) return { success: false, message: 'Orbis couldn’t form an answer. Try rewording the question.' };
  return { success: true, message: '', answer, citations: keepCitations(parsed.citations, context.citations) };
}
