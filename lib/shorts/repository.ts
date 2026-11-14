import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/errors';
import { IN_FLIGHT } from '@/lib/shorts/rules';
import { readEvent, readJob, readStyle, readWorker } from '@/lib/shorts/rows';
import type { ShortPlan } from '@/lib/shorts/plan';
import type { JobStatus, ShortEvent, ShortJob, ShortOptions, ShortStyle, WorkerState } from '@/lib/shorts/types';

// The Shorts tables (supabase/migrations/202611100001_shorts.sql). Reads go
// through the person's own session, so row-level security keeps them to their
// rows; every write takes the admin client after the server action has checked
// who is asking, and every status change is guarded by the status it expects.

export type ShortsDb = SupabaseClient;

export const SHORTS_BUCKET = 'shorts';
export const SIGNED_URL_SECONDS = 3600;

/** An error whose message is safe to show as-is. */
export class ShortsError extends Error {}

const SETUP_MESSAGE = 'Shorts isn’t set up yet. Try again in a little while.';
const LOAD_MESSAGE = 'Shorts couldn’t be loaded. Try again in a little while.';
const SAVE_MESSAGE = 'That couldn’t be saved. Try again in a little while.';
export const MOVED_ON = 'This short has moved on. Reload and try again.';

function failed(error: { code?: string; message?: string }, message: string) {
  console.error(message, error);
  return new ShortsError(isMissingTable(error) ? SETUP_MESSAGE : message);
}

const JOB_COLUMNS = 'id,style,topic,options,status,stage,plan,plan_feedback,delivery,error,attempt,created_at,started_at,finished_at,last_event_at';

export async function listJobs(db: ShortsDb, userId: string, limit = 60): Promise<ShortJob[]> {
  const { data, error } = await db.from('shorts_jobs').select(JOB_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readJob).filter((job): job is ShortJob => job !== null);
}

export async function getJob(db: ShortsDb, userId: string, jobId: string): Promise<ShortJob | null> {
  const { data, error } = await db.from('shorts_jobs').select(JOB_COLUMNS).eq('user_id', userId).eq('id', jobId).maybeSingle();
  if (error) throw failed(error, LOAD_MESSAGE);
  return readJob(data);
}

export async function listEvents(db: ShortsDb, userId: string, jobId: string, afterSeq = 0): Promise<ShortEvent[]> {
  const { data, error } = await db.from('shorts_events').select('seq,kind,content,at')
    .eq('user_id', userId).eq('job_id', jobId).gt('seq', afterSeq).order('seq', { ascending: true }).limit(500);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readEvent).filter((event): event is ShortEvent => event !== null);
}

export async function listStyles(db: ShortsDb): Promise<ShortStyle[]> {
  const { data, error } = await db.from('shorts_styles').select('slug,name,tagline,best_for,seconds_min,seconds_max,is_3d,default_voice,sheet_path,example_title,position').order('position', { ascending: true });
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readStyle).filter((style): style is ShortStyle => style !== null);
}

export async function getWorker(db: ShortsDb, userId: string): Promise<WorkerState | null> {
  const { data, error } = await db.from('shorts_worker').select('last_seen,state,note,voices').eq('user_id', userId).maybeSingle();
  if (error) throw failed(error, LOAD_MESSAGE);
  return data ? readWorker(data) : null;
}

export async function countInFlight(db: ShortsDb, userId: string): Promise<number> {
  const { count, error } = await db.from('shorts_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', IN_FLIGHT as JobStatus[]);
  if (error) throw failed(error, LOAD_MESSAGE);
  return count ?? 0;
}

export async function countSince(db: ShortsDb, userId: string, sinceIso: string): Promise<number> {
  // The daily autopilot's shorts don't count: at one a day they would use up the person's own month.
  const { count, error } = await db.from('shorts_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceIso)
    .or('options->>autopilot.is.null,options->>autopilot.neq.true');
  if (error) throw failed(error, LOAD_MESSAGE);
  return count ?? 0;
}

export async function insertJob(admin: ShortsDb, input: { userId: string; style: string; topic: string; options: ShortOptions }): Promise<ShortJob> {
  const { data, error } = await admin.from('shorts_jobs')
    .insert({ user_id: input.userId, style: input.style, topic: input.topic, options: input.options, status: 'queued', stage: 'plan' })
    .select(JOB_COLUMNS).single();
  if (error) throw failed(error, SAVE_MESSAGE);
  const job = readJob(data);
  if (!job) throw new ShortsError(SAVE_MESSAGE);
  return job;
}

/** Changes a job only while it is still in one of `from`; null when it has moved on. */
export async function updateJob(admin: ShortsDb, userId: string, jobId: string, from: readonly JobStatus[], patch: Record<string, unknown>): Promise<ShortJob | null> {
  const { data, error } = await admin.from('shorts_jobs').update(patch)
    .eq('user_id', userId).eq('id', jobId).in('status', from as JobStatus[])
    .select(JOB_COLUMNS).maybeSingle();
  if (error) throw failed(error, SAVE_MESSAGE);
  return readJob(data);
}

export function approvePatch(plan: ShortPlan) {
  return { plan, status: 'queued', stage: 'build', plan_feedback: null, error: null, started_at: null, finished_at: null };
}

/** Removes the job's files, then the job (its events go with it). */
export async function deleteJob(admin: ShortsDb, userId: string, jobId: string, from: readonly JobStatus[]): Promise<boolean> {
  const prefix = `${userId}/${jobId}`;
  const { data: files, error: listError } = await admin.storage.from(SHORTS_BUCKET).list(prefix, { limit: 100 });
  if (listError) throw failed(listError, SAVE_MESSAGE);
  if (files?.length) {
    const { error: removeError } = await admin.storage.from(SHORTS_BUCKET).remove(files.map((file) => `${prefix}/${file.name}`));
    if (removeError) throw failed(removeError, SAVE_MESSAGE);
  }
  const { data, error } = await admin.from('shorts_jobs').delete().eq('user_id', userId).eq('id', jobId).in('status', from as JobStatus[]).select('id');
  if (error) throw failed(error, SAVE_MESSAGE);
  return (data ?? []).length > 0;
}

/** Signed URLs by path; a path that can't be signed is left out. */
export async function signPaths(admin: ShortsDb, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  try {
    const { data } = await admin.storage.from(SHORTS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
    return new Map((data ?? []).flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [])));
  } catch (error) {
    console.error('Signing shorts files failed', error);
    return new Map();
  }
}
