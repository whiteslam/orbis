'use server';

import { answerFromRecords, type AskResult } from '@/lib/ask/answer';
import { pickSources } from '@/lib/ask/select';
import { readAbout } from '@/lib/ask/about';
import { requireUser } from '@/lib/auth/session';
import { trimHistory } from '@/lib/voice/talk';

export type { AskResult };

/**
 * Answers a typed question from the user's own data, reading only the sources
 * the user ticked. The shared rules (consent, allowance, model) are in
 * answerFromRecords, which spoken questions use too.
 */
export async function askOrbisAction(input: { question: string; sources: string[]; earlier?: unknown; about?: unknown }): Promise<AskResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return { success: false, message: 'Sign in again to ask Orbis.' };
  if (!input || typeof input !== 'object' || typeof input.question !== 'string' || !Array.isArray(input.sources)) return { success: false, message: 'Type a question first.' };

  const question = input.question.replace(/\s+/g, ' ').trim();
  if (question.length < 5) return { success: false, message: 'Type a question first.' };
  if (question.length > 300) return { success: false, message: 'Keep the question under 300 characters.' };
  const sources = pickSources(input.sources);
  const about = readAbout(input.about);
  if (!sources.length && !about) return { success: false, message: 'Choose at least one thing Orbis may look at.' };

  return answerFromRecords({ userId, question, sources, earlier: trimHistory(input.earlier), about });
}
