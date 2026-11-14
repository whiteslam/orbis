'use server';

// Social → Shorts → YouTube: the queue, the schedule and Post now. The person's
// own session reads their shorts; every write to the YouTube tables goes through
// the service role, keyed to the id from requireUser(), never to one the browser
// sent. Nothing here takes a token: the publisher (lib/youtube/publish.ts) reads
// it from the encrypted store itself.

import { requireUser } from '@/lib/auth/session';
import { getPersonSettings } from '@/lib/locale/repository';
import { createAdminClient } from '@/lib/supabase/admin';
import { getJob, ShortsError, signPaths, type ShortsDb } from '@/lib/shorts/repository';
import type { Result } from '@/lib/shorts/view';
import { isUuid } from '@/lib/validate/id';
import { getYouTubeConnection } from '@/lib/youtube/connection';
import { buildDetails, cleanDetails } from '@/lib/youtube/details';
import { youtubeConfigured } from '@/lib/youtube/google';
import { readMove, readSchedule } from '@/lib/youtube/input';
import { publishSlice, settleFailedRow } from '@/lib/youtube/publish';
import {
  getPreset, getSchedule, insertQueued, listPosted, listQueue, moveQueued, removeQueued, retryFailed, saveSchedule, scheduledSince,
  tablesReady, updateQueued, YouTubeQueueError,
} from '@/lib/youtube/repository';
import { defaultSchedule } from '@/lib/youtube/rows';
import { dayStart, nextSlot } from '@/lib/youtube/schedule';
import type { QueueItem, Schedule, VideoDetails, YouTubePanel } from '@/lib/youtube/types';

const SIGN_IN = { success: false as const, message: 'Sign in again to do this.' };
const INVALID = { success: false as const, message: 'That request isn’t valid. Reload and try again.' };
const NOT_FOUND = { success: false as const, message: 'That short isn’t there any more. Reload and try again.' };
const MOVED = 'That video has moved on. Reload and try again.';
const BAD_DETAILS = 'Give the video a title, a category and a privacy setting.';
const BAD_SCHEDULE = 'That schedule isn’t valid. Check the time, the days and the time zone.';
const NOT_WAITING = 'That video isn’t waiting, or it is being posted right now. Reload and check.';
const NOT_REMOVABLE = 'That video is being posted right now, or has moved on. Wait a minute, then reload and try again.';

/**
 * How long Post now works before it stops and lets the cron finish the upload.
 * The slice ends by this plus one request time-out (15 s): 55 s at most, inside
 * the page's 60 s and the 75 s lease.
 */
const POST_NOW_MS = 40_000;

const ok = <T,>(data: T): Result<T> => ({ success: true, data });
const fail = (message: string) => ({ success: false as const, message });

type Me = { userId: string; db: ShortsDb };
type Admin = ReturnType<typeof createAdminClient>;

async function asUser<T>(fallback: string, work: (me: Me) => Promise<Result<T>>): Promise<Result<T>> {
  const signedIn = await requireUser();
  if (!signedIn) return SIGN_IN;
  try {
    return await work({ userId: signedIn.userId, db: signedIn.supabase });
  } catch (error) {
    if (error instanceof ShortsError || error instanceof YouTubeQueueError) return fail(error.message);
    console.error(fallback, error);
    return fail(fallback);
  }
}

/** A path in this person's folder for this short, and nothing that climbs out of it. */
const ownPath = (path: string | null | undefined, userId: string, jobId: string): path is string =>
  typeof path === 'string' && path.startsWith(`${userId}/${jobId}/`) && !path.includes('..');

/** "Fri 18:00" on the schedule's own clock. */
function slotLabel(slot: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(slot);
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '';
  return `${part('weekday')} ${part('hour')}:${part('minute')}`;
}

/** The line under the status: what goes next and when. Null when nothing is waiting or the schedule is off. */
function nextLine(schedule: Schedule, queue: QueueItem[], postedToday: number, now: Date): string | null {
  const head = queue[0];
  if (!head) return null;
  if (head.status === 'uploading') return `Uploading · ${head.title}`;
  const slot = nextSlot(schedule, now, postedToday);
  if (!slot) return null;
  // A time already past means it was missed and nothing has gone out for it: it is due now.
  return `${slot.getTime() <= now.getTime() ? 'Due now' : slotLabel(slot, schedule.timezone)} · ${head.title}`;
}

/** The YouTube panel: connection, schedule, queue, posted list. Without the tables it is an empty, not-ready panel. */
export async function loadYouTubePanelAction(): Promise<Result<YouTubePanel>> {
  return asUser<YouTubePanel>('YouTube couldn’t be loaded. Try again in a little while.', async (me) => {
    const admin = createAdminClient();
    const configured = youtubeConfigured();
    if (!(await tablesReady(admin))) {
      const zone = (await getPersonSettings(me.userId)).timeZone;
      return ok({ configured, ready: false, connection: null, schedule: defaultSchedule(zone), queue: [], posted: [], covers: {}, next: null });
    }
    const now = new Date();
    const [connection, schedule, queue, posted] = await Promise.all([
      getYouTubeConnection(admin, me.userId),
      getSchedule(admin, me.userId),
      listQueue(admin, me.userId),
      listPosted(admin, me.userId),
    ]);
    const postedToday = await scheduledSince(admin, me.userId, dayStart(now, schedule.timezone));
    // Covers by queue row id. Only paths under this person's own folder are ever signed.
    const mine = [...queue, ...posted].filter((item) => item.coverPath?.startsWith(`${me.userId}/`) && !item.coverPath.includes('..'));
    const signed = await signPaths(admin, mine.flatMap((item) => (item.coverPath ? [item.coverPath] : [])));
    const covers: Record<string, string> = {};
    for (const item of mine) {
      const url = item.coverPath ? signed.get(item.coverPath) : undefined;
      if (url) covers[item.id] = url;
    }
    return ok({ configured, ready: true, connection, schedule, queue, posted, covers, next: nextLine(schedule, queue, postedToday, now) });
  });
}

/** What a finished short starts with on YouTube, for the person to edit. */
export async function draftForYouTubeAction(jobId: unknown): Promise<Result<VideoDetails>> {
  if (!isUuid(jobId)) return INVALID;
  return asUser('The details couldn’t be prepared. Try again in a little while.', async (me) => {
    const job = await getJob(me.db, me.userId, jobId);
    if (!job) return NOT_FOUND;
    if (job.status !== 'done' || !job.delivery) return fail('Only a finished short can go to YouTube.');
    const preset = await getPreset(createAdminClient(), me.userId, job.style);
    return ok(buildDetails(job.delivery, preset));
  });
}

/** Puts a finished short at the back of the YouTube queue. */
export async function queueForYouTubeAction(jobId: unknown, details: unknown): Promise<Result<QueueItem>> {
  if (!isUuid(jobId)) return INVALID;
  const cleaned = cleanDetails(details);
  if (!cleaned) return fail(BAD_DETAILS);
  return asUser('The short couldn’t be queued. Try again in a little while.', async (me) => {
    const job = await getJob(me.db, me.userId, jobId);
    if (!job) return NOT_FOUND;
    const files = job.delivery?.files;
    if (job.status !== 'done' || !files || !ownPath(files.video, me.userId, jobId)) return fail('Only a finished short can go to YouTube.');
    const coverPath = ownPath(files.cover, me.userId, jobId) ? files.cover : null;
    return ok(await insertQueued(createAdminClient(), me.userId, { jobId, videoPath: files.video, coverPath, ...cleaned }));
  });
}

/** Runs a change to one waiting row, then returns the queue as it now stands. */
async function changeQueue(
  id: unknown,
  fallback: string,
  change: (admin: Admin, userId: string, rowId: string) => Promise<boolean>,
  refused = MOVED,
): Promise<Result<QueueItem[]>> {
  if (!isUuid(id)) return INVALID;
  return asUser(fallback, async (me) => {
    const admin = createAdminClient();
    if (!(await change(admin, me.userId, id))) return fail(refused);
    return ok(await listQueue(admin, me.userId));
  });
}

export async function updateQueueItemAction(id: unknown, details: unknown): Promise<Result<QueueItem[]>> {
  const cleaned = cleanDetails(details);
  if (!cleaned) return fail(BAD_DETAILS);
  return changeQueue(id, 'The details couldn’t be saved. Try again in a little while.', (admin, userId, rowId) => updateQueued(admin, userId, rowId, cleaned));
}

export async function moveQueueItemAction(id: unknown, dir: unknown): Promise<Result<QueueItem[]>> {
  const way = readMove(dir);
  if (!way) return INVALID;
  return changeQueue(id, 'The video couldn’t be moved. Try again in a little while.', async (admin, userId, rowId) => {
    await moveQueued(admin, userId, rowId, way);
    return true;
  });
}

export async function removeQueueItemAction(id: unknown): Promise<Result<QueueItem[]>> {
  return changeQueue(id, 'The video couldn’t be removed. Try again in a little while.', (admin, userId, rowId) => removeQueued(admin, userId, rowId), NOT_REMOVABLE);
}

/** A failed video goes back to the front of the queue with fresh attempts. */
const ALREADY_POSTED = 'It had already posted to YouTube, so it wasn’t uploaded again.';
const RETRY_RECONNECT = 'Connect YouTube again, then Retry. YouTube may already have this video, so Orbis checks before uploading it again.';
const RETRY_UNAVAILABLE = 'YouTube couldn’t be checked just now, so the video wasn’t queued again. Try again in a little while.';

/**
 * Puts a failed video back at the front of the queue. First, if it kept an upload
 * session, that session is asked whether YouTube already has it: then it is marked
 * posted (with `message` saying so) instead of being uploaded a second time.
 */
export async function retryQueueItemAction(id: unknown): Promise<Result<{ queue: QueueItem[]; message: string | null }>> {
  if (!isUuid(id)) return INVALID;
  return asUser<{ queue: QueueItem[]; message: string | null }>('The video couldn’t be retried. Try again in a little while.', async (me) => {
    const admin = createAdminClient();
    const settled = await settleFailedRow(admin, me.userId, id);
    if (settled === 'published') return ok({ queue: await listQueue(admin, me.userId), message: ALREADY_POSTED });
    // The old upload can't be asked, and it may hold the whole video: keep it rather than upload again.
    if (settled === 'reconnect') return fail(RETRY_RECONNECT);
    if (settled === 'unavailable') return fail(RETRY_UNAVAILABLE);
    if (!(await retryFailed(admin, me.userId, id))) return fail(MOVED);
    return ok({ queue: await listQueue(admin, me.userId), message: null });
  });
}

export type PostNowState = 'published' | 'partial' | 'held' | 'reconnect' | 'failed' | 'retry';

/**
 * Posts one queued video now, outside the schedule. It works for up to 40 s (the
 * page allows 60); a bigger file carries on by itself within 10 minutes
 * ('partial'). It takes the same lease as the cron run, so the two never send
 * the same bytes.
 */
export async function postNowAction(id: unknown): Promise<Result<{ state: PostNowState }>> {
  if (!isUuid(id)) return INVALID;
  return asUser('The video couldn’t be posted. Try again in a little while.', async (me) => {
    const now = new Date();
    const state = await publishSlice(createAdminClient(), me.userId, { rowId: id, postedBy: 'manual', deadline: now.getTime() + POST_NOW_MS, now });
    return state === 'none' ? fail(NOT_WAITING) : ok({ state });
  });
}

/** When and whether to post. */
export async function saveScheduleAction(input: unknown): Promise<Result<Schedule>> {
  const schedule = readSchedule(input);
  if (!schedule) return fail(BAD_SCHEDULE);
  return asUser('The schedule couldn’t be saved. Try again in a little while.', async (me) => {
    const admin = createAdminClient();
    await saveSchedule(admin, me.userId, schedule);
    return ok(await getSchedule(admin, me.userId));
  });
}
