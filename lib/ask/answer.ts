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

export type AskResult = {
  success: boolean;
  message: string;
  answer?: string;
  citations?: Citation[];
  /** What the answer concluded beyond the records, said apart from what was read. */
  inferred?: string[];
  /** Questions worth asking next, to check the answer before acting on it. */
  followUps?: string[];
};

/**
 * Consent first, then whether a model that may see personal data can run at
 * all. Callers check this before anything is read, sent or spent: the spoken
 * path checks it before a recording leaves the server.
 */
export async function askBlockedMessage(userId: string): Promise<string | null> {
  const blocked = await aiBlocked(userId);
  if (blocked === 'off') return AI_OFF_MESSAGE;
  return blocked ? NO_MODEL_MESSAGE : null;
}

/**
 * Claims one of today's Ask credits, or says why not. Every paid call an
 * answer makes (speech-to-text, Jev, the model) comes after this, so a used-up
 * allowance stops the spending too, not just the answer.
 */
export async function claimAskCredit(userId: string): Promise<string | null> {
  try {
    const { data: allowed, error } = await createAdminClient().rpc('consume_ask_orbis_request', { p_user_id: userId, p_daily_limit: DAILY_ASK_LIMIT });
    if (error) return 'Ask Orbis is not set up yet. Apply the Ask Orbis migration in Supabase.';
    if (!allowed) return `You have asked ${DAILY_ASK_LIMIT} questions today. Try again tomorrow.`;
    return null;
  } catch {
    return 'Ask Orbis is not available right now. Try again later.';
  }
}

/**
 * Answers a checked question from the user's own data, typed or spoken.
 *
 * Only the given sources are read, and the request is always 'personal', so it
 * can only reach a model that will not train on it; when no such model is
 * available the user is told so rather than silently downgraded. Typed and
 * spoken questions share the one daily allowance: the records are loaded and
 * checked first (no credit is spent on an empty request), then the credit is
 * claimed, and only then does anything paid run.
 */
export async function answerFromRecords(input: {
  userId: string;
  question: string;
  sources: AskSource[];
  earlier?: TalkTurn[];
  spokenLanguage?: string;
  /** A headline, market reading or holding the question is about. */
  about?: AskAbout | null;
  /** Today's credit is already claimed (the spoken path claims it before transcribing). */
  credited?: boolean;
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
  // A question about a headline can be answered without any records of theirs.
  if (!context.used.length && !input.about) return { success: false, message: 'There is nothing in the last six months of what you chose to look at yet.' };

  const user = askPayload(question, context.data, input.earlier, input.about ?? null);
  if (Buffer.byteLength(user, 'utf8') > MAX_INPUT_BYTES) return { success: false, message: 'That is more data than Orbis can read at once. Untick a source and try again.' };

  const refused = input.credited ? null : await claimAskCredit(userId);
  if (refused) return { success: false, message: refused };

  const feature = input.spokenLanguage ? 'talk_orbis' : 'ask_orbis';
  // Jev reads only the question: whether this needs reasoning decides if Claude or a free model goes first.
  const reasoning = await needsReasoning(userId, question, feature).catch(() => undefined);
  const system = askSystem({ spokenLanguage: input.spokenLanguage, about: input.about ?? null });
  const result = await routeJson({ userId, feature, sensitivity: 'personal', system, user, maxTokens: 700, temperature: 0.2, timeoutMs: 25_000, accept: (text) => readAnswer(text) !== null, escalate: reasoning });
  if (!result) return { success: false, message: NO_MODEL_MESSAGE };

  const parsed = readAnswer(result.text);
  if (!parsed) return { success: false, message: 'Orbis couldn’t form an answer. Try rewording the question.' };
  return { success: true, message: '', answer: parsed.answer, citations: keepCitations(parsed.citations, context.citations), inferred: parsed.inferred, followUps: parsed.followUps };
}

/** Up to `max` distinct non-empty strings from a model's list, each capped. */
function shortList(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, cap);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** The answer and its claimed citations, or null when the reply has no answer in it. */
function readAnswer(text: string): { answer: string; citations: unknown; inferred: string[]; followUps: string[] } | null {
  let parsed: { answer?: unknown; citations?: unknown; inferred?: unknown; followUps?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim().slice(0, 1200) : '';
  return answer ? { answer, citations: parsed.citations, inferred: shortList(parsed.inferred, 2, 240), followUps: shortList(parsed.followUps, 3, 90) } : null;
}
