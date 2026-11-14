'use server';

// Faceless Shorts' server actions: the contract between Social → Shorts and
// lib/shorts. The app only queues and reads; the owner's PC worker
// (workers/shorts-studio) makes the short with Claude Code and the
// faceless-shorts skill. Every action checks the signed-in person first, then
// validates what the browser sent, and every status change is guarded by the
// status it expects, so a click that raced the worker is refused, not applied.

import { requireUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePlan } from '@/lib/shorts/plan';
import {
  approvePatch, countInFlight, countSince, deleteJob, getJob, getWorker, insertJob, listEvents, listJobs, listStyles, MOVED_ON, ShortsError,
  signPaths, updateJob, type ShortsDb,
} from '@/lib/shorts/repository';
import { canApprove, canCancel, canDelete, canRetry, cleanTopic, IN_FLIGHT, LIMITS, limitRefusal, monthStartIn, oneLine, readOptions, workerPresence } from '@/lib/shorts/rules';
import type { JobStatus, ShortJob } from '@/lib/shorts/types';
import type { JobDetail, Result, ShortFiles, ShortsView } from '@/lib/shorts/view';
import { getPersonSettings } from '@/lib/locale/repository';
import { isMissingTable } from '@/lib/supabase/errors';
import { AUTOPILOT_STYLE, defaultAutopilot, readAutopilotRow, type Autopilot } from '@/lib/shorts/autopilot';
import { activeQueueFor, hasActiveQueue } from '@/lib/youtube/repository';

const SIGN_IN = { success: false as const, message: 'Sign in again to do this.' };
const INVALID = { success: false as const, message: 'That request isn’t valid. Reload and try again.' };
const NOT_FOUND = { success: false as const, message: 'That short isn’t there any more. Reload and try again.' };

const ok = <T,>(data: T): Result<T> => ({ success: true, data });
const fail = (message: string) => ({ success: false as const, message });

type Me = { userId: string; db: ShortsDb };

async function asUser<T>(fallback: string, work: (me: Me) => Promise<Result<T>>): Promise<Result<T>> {
  const signedIn = await requireUser();
  if (!signedIn) return SIGN_IN;
  try {
    return await work({ userId: signedIn.userId, db: signedIn.supabase });
  } catch (error) {
    if (error instanceof ShortsError) return fail(error.message);
    console.error(fallback, error);
    return fail(fallback);
  }
}

/** Reads the job through the person's own session, then applies a guarded change with the admin client. */
async function changeJob(me: Me, jobId: unknown, allowed: (job: ShortJob) => boolean, from: readonly JobStatus[], patch: (job: ShortJob) => Record<string, unknown>): Promise<Result<ShortJob>> {
  if (!isUuid(jobId)) return INVALID;
  const job = await getJob(me.db, me.userId, jobId);
  if (!job) return NOT_FOUND;
  if (!allowed(job)) return fail(MOVED_ON);
  const updated = await updateJob(createAdminClient(), me.userId, jobId, from, patch(job));
  return updated ? ok(updated) : fail(MOVED_ON);
}

/** The whole Shorts area: the worker, the style board, the jobs and the month's count. */
export async function loadShortsViewAction(): Promise<Result<ShortsView>> {
  return asUser('Shorts couldn’t be loaded. Try again in a little while.', async (me) => {
    const [worker, styles, jobs, monthUsed] = await Promise.all([
      getWorker(me.db, me.userId),
      listStyles(me.db),
      listJobs(me.db, me.userId),
      countSince(me.db, me.userId, monthStartIn(new Date(), (await getPersonSettings(me.userId)).timeZone)),
    ]);
    const admin = createAdminClient();
    const coverPaths = jobs.flatMap((job) => (job.delivery?.files.cover ? [job.delivery.files.cover] : []));
    const signed = await signPaths(admin, [...styles.flatMap((style) => (style.sheetPath ? [style.sheetPath] : [])), ...coverPaths]);
    const covers: Record<string, string> = {};
    for (const job of jobs) {
      const url = job.delivery?.files.cover ? signed.get(job.delivery.files.cover) : undefined;
      if (url) covers[job.id] = url;
    }
    // A YouTube problem never breaks Shorts: without the tables this is {}.
    const youtube = await activeQueueFor(admin, me.userId, jobs.filter((job) => job.status === 'done').map((job) => job.id)).catch(() => ({}));
    return ok({
      presence: workerPresence(worker, new Date()),
      worker,
      styles: styles.map((style) => ({ ...style, sheetUrl: style.sheetPath ? signed.get(style.sheetPath) ?? null : null })),
      jobs,
      covers,
      monthUsed,
      youtube,
    });
  });
}

/** One job and its events after `afterSeq`: the live view asks only for what it hasn't got. */
export async function loadJobAction(jobId: unknown, afterSeq: unknown): Promise<Result<JobDetail>> {
  if (!isUuid(jobId) || typeof afterSeq !== 'number' || !Number.isInteger(afterSeq) || afterSeq < 0) return INVALID;
  return asUser('That short couldn’t be loaded. Try again in a little while.', async (me) => {
    const [job, events] = await Promise.all([getJob(me.db, me.userId, jobId), listEvents(me.db, me.userId, jobId, afterSeq)]);
    return job ? ok({ job, events }) : NOT_FOUND;
  });
}

/** A new short: the worker writes its plan first, for the owner to approve. */
export async function queueShortAction(input: unknown): Promise<Result<ShortJob>> {
  if (!input || typeof input !== 'object') return INVALID;
  const { style: slug, topic: rawTopic, options: rawOptions } = input as { style?: unknown; topic?: unknown; options?: unknown };
  const topic = cleanTopic(rawTopic);
  if (!topic) return fail(`Describe the short in 1–${LIMITS.topic} characters.`);
  if (typeof slug !== 'string') return INVALID;

  return asUser('The short couldn’t be started. Try again in a little while.', async (me) => {
    const [worker, styles, inFlight, monthUsed] = await Promise.all([
      getWorker(me.db, me.userId),
      listStyles(me.db),
      countInFlight(me.db, me.userId),
      countSince(me.db, me.userId, monthStartIn(new Date(), (await getPersonSettings(me.userId)).timeZone)),
    ]);
    // Only a person whose own PC worker has checked in can queue: nobody else's would ever run.
    if (!worker) return fail('Set up the worker on your Shorts PC first.');
    const style = styles.find((item) => item.slug === slug);
    if (!style) return fail('That style isn’t available. Reload and pick another.');
    const refusal = limitRefusal(inFlight, monthUsed);
    if (refusal) return fail(refusal);
    const options = readOptions(rawOptions ?? {}, style);
    if (!options) return INVALID;
    return ok(await insertJob(createAdminClient(), { userId: me.userId, style: style.slug, topic, options }));
  });
}

/** The owner's edited plan becomes the one the worker builds. */
export async function approvePlanAction(jobId: unknown, plan: unknown): Promise<Result<ShortJob>> {
  const checked = validatePlan(plan);
  if (!checked.ok) return fail(checked.errors.slice(0, 3).join(' '));
  return asUser('The plan couldn’t be approved. Try again in a little while.', (me) =>
    changeJob(me, jobId, canApprove, ['plan_ready'], () => approvePatch(checked.plan)));
}

/** Back to the worker for a new plan, with the owner's notes. */
export async function requestPlanChangesAction(jobId: unknown, feedback: unknown): Promise<Result<ShortJob>> {
  const notes = typeof feedback === 'string' ? feedback.trim().slice(0, LIMITS.feedback) : '';
  if (!notes) return fail('Say what to change.');
  return asUser('The changes couldn’t be sent. Try again in a little while.', (me) =>
    changeJob(me, jobId, canApprove, ['plan_ready'], () => ({ status: 'queued', stage: 'plan', plan_feedback: oneLine(notes, LIMITS.feedback) || notes, error: null })));
}

export async function cancelJobAction(jobId: unknown): Promise<Result<ShortJob>> {
  return asUser('The short couldn’t be stopped. Try again in a little while.', (me) =>
    changeJob(me, jobId, canCancel, IN_FLIGHT, () => ({ status: 'cancelled', finished_at: new Date().toISOString() })));
}

/** A failed short goes back to the worker at the stage it failed in. */
export async function retryJobAction(jobId: unknown): Promise<Result<ShortJob>> {
  return asUser('The short couldn’t be retried. Try again in a little while.', async (me) => {
    const refusal = limitRefusal(await countInFlight(me.db, me.userId), 0);
    if (refusal) return fail(refusal);
    return changeJob(me, jobId, canRetry, ['failed'], (job) => ({ status: 'queued', error: null, attempt: Math.min(50, job.attempt + 1), finished_at: null }));
  });
}

export async function deleteShortAction(jobId: unknown): Promise<Result<null>> {
  if (!isUuid(jobId)) return INVALID;
  return asUser('The short couldn’t be deleted. Try again in a little while.', async (me) => {
    const job = await getJob(me.db, me.userId, jobId);
    if (!job) return NOT_FOUND;
    if (!canDelete(job)) return fail('Stop the short before deleting it.');
    // R6: a short waiting in (or uploading from) the YouTube queue can't go, or its video would vanish from under the row.
    const admin = createAdminClient();
    if (await hasActiveQueue(admin, me.userId, jobId)) return fail('Remove it from the YouTube queue first.');
    const removed = await deleteJob(admin, me.userId, jobId, ['done', 'failed', 'cancelled']);
    return removed ? ok(null) : fail(MOVED_ON);
  });
}

/** One-hour links to a finished short's files. */
export async function loadFilesAction(jobId: unknown): Promise<Result<ShortFiles>> {
  if (!isUuid(jobId)) return INVALID;
  return asUser('The files couldn’t be opened. Try again in a little while.', async (me) => {
    const job = await getJob(me.db, me.userId, jobId);
    const files = job?.delivery?.files;
    if (!job || !files) return NOT_FOUND;
    // Only paths under this person's own folder are ever signed.
    const own = (path: string | null) => (path && path.startsWith(`${me.userId}/${jobId}/`) ? path : null);
    const signed = await signPaths(createAdminClient(), [files.video, files.share, files.cover, files.sheet].map(own).filter((path): path is string => path !== null));
    const url = (path: string | null) => { const mine = own(path); return mine ? signed.get(mine) ?? null : null; };
    const video = url(files.video);
    if (!video) return fail('The video couldn’t be opened. Try again in a little while.');
    return ok({ video, share: url(files.share), cover: url(files.cover), sheet: url(files.sheet) });
  });
}

/** The daily autopilot as saved, and whether its table is there yet (the autopilot migration). */
type AutopilotState = { autopilot: Autopilot; ready: boolean };

export async function loadAutopilotAction(): Promise<Result<AutopilotState>> {
  return asUser<AutopilotState>('The autopilot couldn’t be loaded. Try again in a little while.', async (me) => {
    const { timeZone } = await getPersonSettings(me.userId);
    const { data, error } = await me.db.from('shorts_autopilot').select('enabled,style,start_time,timezone,last_run_on').eq('user_id', me.userId).maybeSingle();
    if (error) {
      if (isMissingTable(error)) return ok({ autopilot: defaultAutopilot(timeZone), ready: false });
      throw error;
    }
    return ok({ autopilot: readAutopilotRow(data, timeZone), ready: true });
  });
}

const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Turns the autopilot on or off and sets when each day's short starts, on the person's own clock. */
export async function saveAutopilotAction(input: unknown): Promise<Result<Autopilot>> {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof raw.enabled !== 'boolean' || typeof raw.startTime !== 'string' || !START_TIME.test(raw.startTime)) return fail('Pick a start time.');
  const enabled = raw.enabled;
  const startTime = raw.startTime;
  return asUser('The autopilot couldn’t be saved. Try again in a little while.', async (me) => {
    const { timeZone } = await getPersonSettings(me.userId);
    // The service role writes: people only read their row. last_run_on is the worker's and is left as it is.
    const { error } = await createAdminClient().from('shorts_autopilot').upsert(
      { user_id: me.userId, enabled, start_time: startTime, timezone: timeZone, style: AUTOPILOT_STYLE },
      { onConflict: 'user_id' },
    );
    if (error) {
      if (isMissingTable(error)) return fail('The autopilot needs its migration in Supabase first (202611140001_shorts_autopilot.sql).');
      throw error;
    }
    const { data } = await me.db.from('shorts_autopilot').select('enabled,style,start_time,timezone,last_run_on').eq('user_id', me.userId).maybeSingle();
    return ok(readAutopilotRow(data, timeZone));
  });
}
