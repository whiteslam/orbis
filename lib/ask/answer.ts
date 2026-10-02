import 'server-only';

import { buildAskContext } from '@/lib/ask/context';
import { askPayload, askSystem } from '@/lib/ask/prompt';
import { keepCitations, type AskSource, type Citation } from '@/lib/ask/select';
import { AI_OFF_MESSAGE } from '@/lib/ai/consent';
import { aiBlocked } from '@/lib/ai/gate';
import { needsReasoning } from '@/lib/ai/jev';
import { routeJson } from '@/lib/ai/router';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TalkTurn } from '@/lib/voice/talk';
import type { AskAbout } from '@/lib/ask/about';

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
  /** A headline, market reading or holding the question is about. */
  about?: AskAbout | null;
}): Promise<AskResult> {
  const { userId, question, sources } = input;
  const blocked = await askBlockedMessage(userId);
  if (blocked) return { success: false, message: blocked };

  const feature = input.spokenLanguage ? 'talk_orbis' : 'ask_orbis';
  // Jev reads only the question, while the records load, so it adds no wait:
  // whether this needs reasoning decides if Claude or a free model goes first.
  const reasoning = needsReasoning(userId, question, feature).catch(() => undefined);
  let context: Awaited<ReturnType<typeof buildAskContext>>;
  try {
    context = await buildAskContext(userId, question, sources);
  } catch {
    return { success: false, message: 'Your records could not be loaded. Try again.' };
  }
  // A question about a headline can be answered without any records of theirs.
  if (!context.used.length && !input.about) return { success: false, message: 'There is nothing in the last six months of what you chose to look at yet.' };

  const user = askPayload(question, context.data, input.earlier, input.about ?? null);
  if (Buffer.byteLength(user, 'utf8') > MAX_INPUT_BYTES) return { success: false, message: 'That is more data than Orbis can read at once. Untick a source and try again.' };

  try {
    const { data: allowed, error } = await createAdminClient().rpc('consume_ask_orbis_request', { p_user_id: userId, p_daily_limit: DAILY_ASK_LIMIT });
    if (error) return { success: false, message: 'Ask Orbis is not set up yet. Apply the Ask Orbis migration in Supabase.' };
    if (!allowed) return { success: false, message: `You have asked ${DAILY_ASK_LIMIT} questions today. Try again tomorrow.` };
  } catch {
    return { success: false, message: 'Ask Orbis is not available right now. Try again later.' };
  }

  const system = askSystem({ spokenLanguage: input.spokenLanguage, about: input.about ?? null });
  const result = await routeJson({ userId, feature, sensitivity: 'personal', system, user, maxTokens: 700, temperature: 0.2, timeoutMs: 25_000, accept: (text) => readAnswer(text) !== null, escalate: await reasoning });
  if (!result) return { success: false, message: NO_MODEL_MESSAGE };

  const parsed = readAnswer(result.text);
  if (!parsed) return { success: false, message: 'Orbis couldn’t form an answer. Try rewording the question.' };
  return { success: true, message: '', answer: parsed.answer, citations: keepCitations(parsed.citations, context.citations) };
}

/** The answer and its claimed citations, or null when the reply has no answer in it. */
function readAnswer(text: string): { answer: string; citations: unknown } | null {
  let parsed: { answer?: unknown; citations?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim().slice(0, 1200) : '';
  return answer ? { answer, citations: parsed.citations } : null;
}
