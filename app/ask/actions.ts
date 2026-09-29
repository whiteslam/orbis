'use server';

import { answerFromRecords, type AskResult } from '@/lib/ask/answer';
import { ASK_SOURCES, type AskSource } from '@/lib/ask/select';
import { requireUser } from '@/lib/auth/session';

export type { AskResult };

const SOURCE_IDS = ASK_SOURCES.map((source) => source.id);

/**
 * Answers a typed question from the user's own data, reading only the sources
 * the user ticked. The shared rules (consent, allowance, model) are in
 * answerFromRecords, which spoken questions use too.
 */
export async function askOrbisAction(input: { question: string; sources: string[] }): Promise<AskResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return { success: false, message: 'Sign in again to ask Orbis.' };
  if (!input || typeof input !== 'object' || typeof input.question !== 'string' || !Array.isArray(input.sources)) return { success: false, message: 'Type a question first.' };

  const question = input.question.replace(/\s+/g, ' ').trim();
  if (question.length < 5) return { success: false, message: 'Type a question first.' };
  if (question.length > 300) return { success: false, message: 'Keep the question under 300 characters.' };
  const sources = Array.from(new Set(input.sources.filter((source): source is AskSource => SOURCE_IDS.includes(source as AskSource))));
  if (!sources.length) return { success: false, message: 'Choose at least one thing Orbis may look at.' };

  return answerFromRecords({ userId, question, sources });
}
