/**
 * Jev: TypeSafe's structured decision model, reached through OpenRouter's
 * System One endpoint. Pure; the call itself is in lib/ai/jev.ts.
 *
 * Jev does not write text. It answers typed questions about a state (pick one
 * option, yes or no, a place on a scale) with probabilities. Orbis uses it as
 * the task classifier the router never had: before a quality feature runs, Jev
 * reads the request and says whether it needs reasoning, and the router puts
 * Claude first only when it does.
 *
 * Every request asks OpenRouter for zero data retention and no data
 * collection. OpenRouter applies those filters on this endpoint (a max_price
 * cap that nothing meets is refused), and TypeSafe passed both when checked on
 * 2026-10-01; if that ever changes, the call is refused rather than sent.
 */
import type { TokenUsage } from '@/lib/ai/attempt';

export const JEV_PRIVACY = { zdr: true, data_collection: 'deny' } as const;

/**
 * The chosen option's probability below which Jev counts as unsure and the
 * budget mode decides instead. Jev's own "confidence" is not used: it
 * summarises the whole distribution and read 0.47 on a question Jev answered
 * correctly at 0.74 (checked live on 2026-10-01).
 */
export const MIN_PROBABILITY = 0.65;
const QUESTION_CHARS = 600;

export type Depth = 'lookup' | 'reasoning';
export const DEPTHS: Depth[] = ['lookup', 'reasoning'];

/**
 * "Does this need reasoning?" for one question. Only the question goes, never
 * the records it will be answered from.
 */
export function questionDepthRequest(model: string, question: string) {
  return {
    model,
    state: { question: question.slice(0, QUESTION_CHARS) },
    questions: {
      depth: {
        type: 'choice' as const,
        instructions: 'How much reasoning does answering this question about a person\'s own records need?',
        criteria: {
          lookup: 'A single fact, total or recent entry that can be read straight from the records.',
          reasoning: 'Comparing periods, spotting patterns or causes, or combining several kinds of records.',
        },
      },
    },
    provider: { ...JEV_PRIVACY },
  };
}

export type Decision = { choice: string | null; probability: number; usage: TokenUsage | null; costUsd: number | null };

const nonNegative = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * One question's answer from a System One reply. `choice` is null when Jev was
 * unsure or answered outside the options, so the caller falls back to its own
 * rule; usage and cost are kept either way so the call is still logged.
 */
export function readDecision(body: unknown, key: string, options: string[]): Decision | null {
  if (!body || typeof body !== 'object') return null;
  const reply = body as { answers?: Record<string, { choice?: unknown; probabilities?: Record<string, unknown> }>; usage?: { input_tokens?: unknown; output_tokens?: unknown; cost?: unknown } };
  if (!reply.answers || typeof reply.answers !== 'object') return null;
  const input = nonNegative(reply.usage?.input_tokens);
  const output = nonNegative(reply.usage?.output_tokens);
  const usage = input === null || output === null ? null : { inputTokens: input, outputTokens: output };
  const costUsd = nonNegative(reply.usage?.cost);
  const answer = reply.answers[key];
  const picked = typeof answer?.choice === 'string' && options.includes(answer.choice) ? answer.choice : null;
  const probability = picked ? nonNegative(answer?.probabilities?.[picked]) ?? 0 : 0;
  return { choice: picked && probability >= MIN_PROBABILITY ? picked : null, probability, usage, costUsd };
}
