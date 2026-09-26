'use server';

import { revalidatePath } from 'next/cache';
import { EmbeddingError } from '@/lib/health-docs/embeddings';
import { buildPlanContext, generateHealthPlan, generatePlanQuestions, MIN_QUESTIONS } from '@/lib/health-docs/planner';
import { deleteHealthDocument, signedDownloadUrl, storeHealthDocument } from '@/lib/health-docs/repository';
import type { HealthPlan, PlanAnswer, PlanQuestion } from '@/lib/health-docs/types';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { parseDocument } from '@/lib/workbook/parse';

type Result<T> = { success: true; data: T; message?: string } | { success: false; message: string };

const DAILY_AI_LIMIT = 10;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

async function authenticatedUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

async function consumeAiRequest(userId: string) {
  try {
    const { data, error } = await createAdminClient().rpc('consume_workbook_ai_request', { p_user_id: userId, p_daily_limit: DAILY_AI_LIMIT });
    if (error) return 'AI usage limits are not set up yet. Apply the workbook usage migration in Supabase.';
    return data ? null : `You’ve reached today’s limit of ${DAILY_AI_LIMIT} AI requests. Try again tomorrow.`;
  } catch {
    return 'AI usage limits are not available right now. Try again later.';
  }
}


/** Marks a document as one the plan builder reads every time. */
export async function setHealthDocumentAlwaysAction(input: unknown): Promise<Result<null>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again to change this.' };
  if (!input || typeof input !== 'object') return { success: false, message: 'That document could not be found.' };
  const { id, always } = input as { id?: unknown; always?: unknown };
  if (!validId(id) || typeof always !== 'boolean') return { success: false, message: 'That document could not be found.' };

  const { error } = await auth.supabase
    .from('health_documents')
    .update({ always_include: always })
    .eq('id', id)
    .eq('user_id', auth.userId);
  if (error) {
    return { success: false, message: error.code === '42703' ? 'Apply the master document migration in Supabase first.' : 'That change could not be saved. Try again.' };
  }
  revalidatePath('/');
  return { success: true, data: null, message: always ? 'Orbis will read this in every plan.' : 'Removed from every plan.' };
}

export async function uploadHealthDocumentAction(formData: FormData): Promise<Result<{ id: string; chunkCount: number }>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again before uploading.' };
  const file = formData.get('document');
  if (!(file instanceof File)) return { success: false, message: 'Choose an Excel workbook or PDF file.' };

  let parsed: Awaited<ReturnType<typeof parseDocument>>;
  try {
    parsed = await parseDocument(file);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'This file could not be read.' };
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
    return { success: false, message: error instanceof EmbeddingError || error instanceof Error ? error.message : 'The document could not be saved.' };
  }
}

export async function deleteHealthDocumentAction(id: string): Promise<Result<null>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again to manage documents.' };
  if (!validId(id)) return { success: false, message: 'This document is invalid.' };
  try {
    await deleteHealthDocument(auth.userId, id);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'The document could not be deleted.' };
  }
  revalidatePath('/');
  return { success: true, data: null, message: 'Document and its search index deleted.' };
}

export async function downloadHealthDocumentAction(id: string): Promise<Result<string>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again to download.' };
  if (!validId(id)) return { success: false, message: 'This document is invalid.' };
  try {
    return { success: true, data: await signedDownloadUrl(auth.userId, id) };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'The file could not be downloaded.' };
  }
}

export async function startHealthPlanAction(): Promise<Result<PlanQuestion[]>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again to build a plan.' };
  // Plans can't be saved without the migration; check before spending AI requests.
  const { error: tableError } = await auth.supabase.from('health_plans').select('id', { head: true, count: 'exact' }).limit(1);
  if (tableError) return { success: false, message: 'Apply the health documents migration in Supabase to build and save plans.' };
  const limited = await consumeAiRequest(auth.userId);
  if (limited) return { success: false, message: limited };

  const startedAt = Date.now();
  try {
    const context = await buildPlanContext(auth.userId, 'health fitness measurements weight heart rate blood sleep activity steps diet conditions');
    const result = await generatePlanQuestions(auth.userId, context);
    if (!result.questions.length) return { success: false, message: 'No AI provider that can hold your documents is available right now. Try again shortly.' };
    return { success: true, data: result.questions };
  } catch {
    return { success: false, message: 'Orbis couldn’t prepare your questions. Try again shortly.' };
  }
}

export async function generateHealthPlanAction(input: { answers: PlanAnswer[] }): Promise<Result<{ id: string; plan: HealthPlan }>> {
  const auth = await authenticatedUser();
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
    if (error || !data) return { success: false, message: 'Your plan was created but couldn’t be saved. Apply the health documents migration and try again.' };
    revalidatePath('/');
    return { success: true, data: { id: data.id, plan: result.plan } };
  } catch {
    return { success: false, message: 'Orbis couldn’t generate your plan. Try again shortly.' };
  }
}

export async function deleteHealthPlanAction(id: string): Promise<Result<null>> {
  const auth = await authenticatedUser();
  if (!auth) return { success: false, message: 'Sign in again to manage plans.' };
  if (!validId(id)) return { success: false, message: 'This plan is invalid.' };
  const { error } = await auth.supabase.from('health_plans').delete().eq('id', id).eq('user_id', auth.userId);
  if (error) return { success: false, message: 'The plan could not be deleted.' };
  revalidatePath('/');
  return { success: true, data: null, message: 'Plan deleted.' };
}
