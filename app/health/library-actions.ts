'use server';

import { AI_OFF_MESSAGE, aiAllowed } from '@/lib/ai/consent';
import { getAiConsent } from '@/lib/ai/consent-store';
import { aiBlocked } from '@/lib/ai/gate';
import { requireUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { revalidatePath } from 'next/cache';
import { userMessage } from '@/lib/errors';
import { EmbeddingError } from '@/lib/health-docs/embeddings';
import { buildPlanContext, generateHealthPlan, generatePlanQuestions, MIN_QUESTIONS } from '@/lib/health-docs/planner';
import { deleteHealthDocument, setAlwaysInclude, signedDownloadUrl, storeHealthDocument } from '@/lib/health-docs/repository';
import type { HealthPlan, PlanAnswer, PlanQuestion } from '@/lib/health-docs/types';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { ALREADY_CLAIMED_MESSAGE, claimStaged, createUploadTarget, downloadOwned, removeStaged } from '@/lib/storage/signed-upload';
import { stagedInput } from '@/lib/storage/upload-rules';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDocument } from '@/lib/workbook/parse';

type Result<T> = { success: true; data: T; message?: string } | { success: false; message: string };

const DAILY_AI_LIMIT = 10;
const MAX_DOCUMENTS = 50;
const DOCUMENT_CAP_MESSAGE = `You can keep up to ${MAX_DOCUMENTS} documents. Delete one you no longer need to add another.`;

const NO_PROVIDER_MESSAGE = 'No AI provider that can hold your documents is available right now. Try again shortly.';

/**
 * The gate for a plan request: consent and a model that may read documents
 * first, then the daily credit, so a request that could never be sent is not
 * charged. Returns the message to show, or null to go ahead.
 */
async function consumeAiRequest(userId: string) {
  const blocked = await aiBlocked(userId, 'personal');
  if (blocked === 'off') return AI_OFF_MESSAGE;
  if (blocked) return NO_PROVIDER_MESSAGE;
  try {
    const { data, error } = await createAdminClient().rpc('consume_workbook_ai_request', { p_user_id: userId, p_daily_limit: DAILY_AI_LIMIT });
    if (error) {
      console.error('consume_workbook_ai_request failed', error);
      return 'AI requests aren’t available right now. Try again later.';
    }
    return data ? null : `You’ve reached today’s limit of ${DAILY_AI_LIMIT} AI requests. Try again tomorrow.`;
  } catch {
    return 'AI usage limits are not available right now. Try again later.';
  }
}


/** Marks a document as one the plan builder reads every time. */
export async function setHealthDocumentAlwaysAction(input: unknown): Promise<Result<null>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to change this.' };
  if (!input || typeof input !== 'object') return { success: false, message: 'That document could not be found.' };
  const { id, always } = input as { id?: unknown; always?: unknown };
  if (!isUuid(id) || typeof always !== 'boolean') return { success: false, message: 'That document could not be found.' };

  try {
    await setAlwaysInclude(auth.userId, id, always);
  } catch (error) {
    return { success: false, message: userMessage(error, 'That change could not be saved. Try again.') };
  }
  revalidatePath('/');
  return { success: true, data: null, message: always ? 'Orbis will read this in every plan.' : 'Removed from every plan.' };
}

/** How many documents this person has saved, or null when that can't be read. */
async function documentCount(userId: string) {
  const { count, error } = await createAdminClient().from('health_documents').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) {
    console.error('Counting health documents failed', error);
    return null;
  }
  return count ?? 0;
}

/**
 * Step one of an upload: checks the document cap and the daily upload limit, then
 * hands the browser a one-time token to put the file straight into Storage.
 */
export async function signHealthDocumentUploadAction(file: { name: string; type: string; size: number }): Promise<Result<{ path: string; token: string; contentType: string }>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again before uploading.' };
  // Adding a document indexes its text with an AI model, so it waits for AI to be on.
  if (!aiAllowed(await getAiConsent(auth.userId))) return { success: false, message: AI_OFF_MESSAGE };
  const count = await documentCount(auth.userId);
  if (count === null) return { success: false, message: 'Uploads aren’t available right now. Try again in a little while.' };
  if (count >= MAX_DOCUMENTS) return { success: false, message: DOCUMENT_CAP_MESSAGE };
  const refused = await rateLimitRefusal(auth.userId, 'uploads');
  if (refused) return { success: false, message: refused };
  try {
    return { success: true, data: await createUploadTarget(auth.userId, 'health-document', file) };
  } catch (error) {
    return { success: false, message: userMessage(error, 'The upload could not be started.') };
  }
}

/**
 * Step two: reads the file the browser uploaded, indexes it, and removes the staged
 * copy. The path is claimed once, atomically, before anything is charged or read,
 * so concurrent or repeated calls for one upload index it at most once.
 */
export async function uploadHealthDocumentAction(input: { path: string; name: string }): Promise<Result<{ id: string; chunkCount: number }>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again before uploading.' };
  // A forged or malformed path is refused before it can cost a credit.
  const staged = stagedInput(auth.userId, input);
  if (!staged) return { success: false, message: 'That upload could not be found. Choose the file again.' };
  try {
    if (!(await claimStaged(auth.userId, staged.path))) return { success: false, message: ALREADY_CLAIMED_MESSAGE };
  } catch (error) {
    return { success: false, message: userMessage(error, 'Uploads aren’t available right now. Try again in a little while.') };
  }

  // Only the caller that won the claim reaches here, so only it deletes the staged file.
  const { path, name } = staged;
  try {
    // Asked again before the parse credit: AI may have been turned off since step one.
    if (!aiAllowed(await getAiConsent(auth.userId))) return { success: false, message: AI_OFF_MESSAGE };
    // Indexing (parse plus embeddings) is the costly step, so it is charged here too.
    const refused = await rateLimitRefusal(auth.userId, 'parse');
    if (refused) return { success: false, message: refused };
    // Checked again here: a token signed earlier must not carry anyone past the cap.
    const count = await documentCount(auth.userId);
    if (count === null) return { success: false, message: 'Uploads aren’t available right now. Try again in a little while.' };
    if (count >= MAX_DOCUMENTS) return { success: false, message: DOCUMENT_CAP_MESSAGE };

    let file: File;
    let parsed: Awaited<ReturnType<typeof parseDocument>>;
    try {
      file = await downloadOwned(auth.userId, 'health-document', path, name);
      parsed = await parseDocument(file);
    } catch (error) {
      return { success: false, message: userMessage(error, 'This file could not be read.') };
    }

    try {
      const kind = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx';
      const saved = await storeHealthDocument(auth.userId, { file, fileName: parsed.preview.fileName, kind, preview: parsed.preview, textLines: parsed.textLines });
      revalidatePath('/');
      return {
        success: true,
        data: { id: saved.id, chunkCount: saved.chunkCount },
        message: saved.storedOriginal
          ? `Saved ${parsed.preview.fileName} and indexed ${saved.chunkCount} sections for AI search.`
          : `Indexed ${saved.chunkCount} sections of ${parsed.preview.fileName}. The original was over 50 MB, so only its text was kept.`,
      };
    } catch (error) {
      // EmbeddingError messages are written for the user; anything else is logged.
      return { success: false, message: error instanceof EmbeddingError ? error.message : userMessage(error, 'The document could not be saved.') };
    }
  } finally {
    // The staged copy is never kept: a saved original lives in health-documents.
    await removeStaged(auth.userId, 'health-document', path);
  }
}

export async function deleteHealthDocumentAction(id: string): Promise<Result<null>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to manage documents.' };
  if (!isUuid(id)) return { success: false, message: 'This document is invalid.' };
  try {
    await deleteHealthDocument(auth.userId, id);
  } catch (error) {
    return { success: false, message: userMessage(error, 'The document could not be deleted.') };
  }
  revalidatePath('/');
  return { success: true, data: null, message: 'Document and its search index deleted.' };
}

export async function downloadHealthDocumentAction(id: string): Promise<Result<string>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to download.' };
  if (!isUuid(id)) return { success: false, message: 'This document is invalid.' };
  try {
    return { success: true, data: await signedDownloadUrl(auth.userId, id) };
  } catch (error) {
    return { success: false, message: userMessage(error, 'The file could not be downloaded.') };
  }
}

export async function startHealthPlanAction(): Promise<Result<PlanQuestion[]>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to build a plan.' };
  // Plans can't be saved without the migration; check before spending AI requests.
  const { error: tableError } = await auth.supabase.from('health_plans').select('id', { head: true, count: 'exact' }).limit(1);
  if (tableError) {
    console.error('health_plans could not be read', tableError);
    return { success: false, message: 'Plans can’t be built right now. Try again later.' };
  }
  const limited = await consumeAiRequest(auth.userId);
  if (limited) return { success: false, message: limited };

  const startedAt = Date.now();
  try {
    const context = await buildPlanContext(auth.userId, 'health fitness measurements weight heart rate blood sleep activity steps diet conditions');
    const result = await generatePlanQuestions(auth.userId, context);
    if (!result.questions.length) return { success: false, message: NO_PROVIDER_MESSAGE };
    return { success: true, data: result.questions };
  } catch {
    return { success: false, message: 'Orbis couldn’t prepare your questions. Try again shortly.' };
  }
}

export async function generateHealthPlanAction(input: { answers: PlanAnswer[] }): Promise<Result<{ id: string; plan: HealthPlan }>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to build a plan.' };
  if (!input || !Array.isArray(input.answers)) return { success: false, message: 'Answer the questions first.' };
  const answers: PlanAnswer[] = input.answers.slice(0, 20).flatMap((item) => {
    if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') return [];
    const answer = item.answer.trim().slice(0, 500);
    return answer ? [{ id: String(item.id).slice(0, 10), question: item.question.trim().slice(0, 200), answer }] : [];
  });
  if (answers.length < MIN_QUESTIONS) return { success: false, message: `Answer at least ${MIN_QUESTIONS} questions so the plan fits you.` };

  const limited = await consumeAiRequest(auth.userId);
  if (limited) return { success: false, message: limited };

  const startedAt = Date.now();
  try {
    const context = await buildPlanContext(auth.userId, answers.map((answer) => `${answer.question} ${answer.answer}`).join(' ').slice(0, 2000));
    const result = await generateHealthPlan(auth.userId, context, answers);
    if (!result.plan) {
      return { success: false, message: 'The AI returned an incomplete plan. Try generating again.' };
    }
    const { data, error } = await createAdminClient().from('health_plans').insert({ user_id: auth.userId, title: result.plan.title, answers, plan: result.plan }).select('id').single();
    if (error || !data) {
      console.error('Saving a health plan failed', error);
      return { success: false, message: 'Your plan was created but couldn’t be saved. Try again in a moment.' };
    }
    revalidatePath('/');
    return { success: true, data: { id: data.id, plan: result.plan } };
  } catch {
    return { success: false, message: 'Orbis couldn’t generate your plan. Try again shortly.' };
  }
}

export async function deleteHealthPlanAction(id: string): Promise<Result<null>> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to manage plans.' };
  if (!isUuid(id)) return { success: false, message: 'This plan is invalid.' };
  const { error } = await auth.supabase.from('health_plans').delete().eq('id', id).eq('user_id', auth.userId);
  if (error) return { success: false, message: 'The plan could not be deleted.' };
  revalidatePath('/');
  return { success: true, data: null, message: 'Plan deleted.' };
}
