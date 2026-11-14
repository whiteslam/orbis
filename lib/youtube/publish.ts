import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { getYouTubeRefreshToken, markYouTubeReconnect, recordYouTubePublish } from '@/lib/youtube/connection';
import { MAX_ATTEMPTS } from '@/lib/youtube/details';
import { mintAccessToken, YouTubeAuthError } from '@/lib/youtube/google';
import {
  failedRow, getSchedule, listQueue, release, saveUpload, scheduledSince, setHold, settlePublished, takeRow, uploadingRowId, usersWithWork, YouTubeReadError,
} from '@/lib/youtube/repository';
import type { QueueRowFull } from '@/lib/youtube/rows';
import { dayStart, isDue, nextDayStart } from '@/lib/youtube/schedule';
import { askSession, rangeReader, REQUEST_TIMEOUT_MS, runUpload, type UploadOutcome } from '@/lib/youtube/upload';
import { signVideo } from '@/lib/youtube/video-file';

// Posting to YouTube, one slice at a time (spec: "Publishing run", rulings
// R1–R5). A slice takes one row under a lease, sends what it can before the
// deadline, and always lets the row go again. The cron calls publishDue for
// everyone with work; Post now calls publishSlice for one person and one row.

type Admin = ReturnType<typeof createAdminClient>;

export type SliceResult = 'none' | 'partial' | 'published' | 'held' | 'reconnect' | 'failed' | 'retry';

export const QUOTA_MESSAGE = 'YouTube’s daily upload limit was reached. Trying again on the next posting day.';
export const MISSING_MESSAGE = 'video file missing';
const GOOGLE_DOWN = 'Google couldn’t be reached to sign in.';
const UNSIGNED = 'The video file couldn’t be opened for upload.';

/** fetch with the same per-request time limit the upload uses. */
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

/** Failed for good: there is no video to send. */
const MISSING = { status: 'failed', error: MISSING_MESSAGE, upload_url: null, bytes_sent: 0 } as const;

/** Back in the queue as if never started: a queued row never keeps an upload session. */
const BACK_IN_QUEUE = { status: 'queued', upload_url: null, bytes_sent: 0 } as const;

type SliceOptions = { rowId?: string; postedBy: 'schedule' | 'manual'; deadline: number; now: Date };

/** Which row this slice works on, taken under a lease, or null when there is nothing to do. */
async function pick(admin: Admin, userId: string, opts: SliceOptions): Promise<QueueRowFull | null> {
  // Post now works on the chosen row and no other: start it, or carry on with
  // it if an earlier Post now left it part-way.
  if (opts.rowId) {
    return (await takeRow(admin, userId, opts.rowId, 'queued', opts.postedBy)) ?? takeRow(admin, userId, opts.rowId, 'uploading');
  }
  // R4 (the cron): an upload already under way is finished first, due or not.
  const uploading = await uploadingRowId(admin, userId);
  if (uploading) return takeRow(admin, userId, uploading, 'uploading');

  // Strict reads: if the pause switch or the day's posts can't be read,
  // nothing is due. A guessed default could post while paused, or too often.
  let due: boolean;
  try {
    const schedule = await getSchedule(admin, userId, { strict: true });
    due = isDue(schedule, opts.now, await scheduledSince(admin, userId, dayStart(opts.now, schedule.timezone), { strict: true }));
  } catch (error) {
    if (!(error instanceof YouTubeReadError)) throw error;
    console.error('YouTube schedule unreadable; not posting for now:', error.message);
    return null;
  }
  if (!due) return null;
  const next = (await listQueue(admin, userId)).find((item) => item.status === 'queued');
  return next ? takeRow(admin, userId, next.id, 'queued', opts.postedBy) : null;
}

/** True only for a path inside the person's own folder: nothing else is ever signed. */
const ownPath = (userId: string, videoPath: string) => videoPath.startsWith(`${userId}/`) && !videoPath.includes('..');

/** One slice of publishing for one person. */
export async function publishSlice(admin: Admin, userId: string, opts: SliceOptions): Promise<SliceResult> {
  const row = await pick(admin, userId, opts);
  if (!row) return 'none';

  // Whatever happens, the lease is given back. A throw leaves the row as it was
  // (uploading rows resume on the next run).
  let patch: Record<string, unknown> = {};
  // The row's upload session, as last saved: the one it came with, or one this slice opened.
  let session = row.uploadUrl;
  // A row without a session goes back to the queue. One with a session stays
  // uploading to be finished, even at 0 bytes: a one-chunk video may be on
  // YouTube already if the answer to that chunk was lost.
  const pause = () => (session ? {} : { ...BACK_IN_QUEUE });
  // An attempt used up. A row with a session keeps it, whether it stays
  // uploading or (after the last attempt) fails: YouTube may already have every
  // byte (the answer to the final chunk was lost), so the next slice, or Retry
  // (settleFailedRow), asks that session what it has rather than upload the
  // video again. Without a session it goes back to the queue, or fails.
  const countError = (message: string): SliceResult => {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      patch = session ? { status: 'failed', attempts, error: message } : { status: 'failed', attempts, error: message, upload_url: null, bytes_sent: 0 };
      return 'failed';
    }
    patch = session ? { status: 'uploading', attempts, error: message } : { status: 'queued', attempts, error: message, upload_url: null, bytes_sent: 0 };
    return 'retry';
  };
  try {
    // A path outside the person's own folder can never be sent.
    if (!ownPath(userId, row.videoPath)) {
      patch = { ...MISSING };
      return 'failed';
    }

    const refreshToken = await getYouTubeRefreshToken(admin, userId);
    if (!refreshToken) {
      await markYouTubeReconnect(admin, userId);
      patch = pause();
      return 'reconnect';
    }

    let accessToken: string;
    try {
      accessToken = await mintAccessToken(refreshToken, timedFetch);
    } catch (error) {
      if (error instanceof YouTubeAuthError && error.reconnect) {
        await markYouTubeReconnect(admin, userId);
        patch = pause();
        return 'reconnect';
      }
      // Google down, a time-out or a misconfigured server: like any network error, it uses an attempt.
      // Only the message is logged; a token never is.
      const message = error instanceof YouTubeAuthError ? error.message : GOOGLE_DOWN;
      console.error('Could not mint a YouTube access token:', message);
      return countError(message);
    }

    // A video storage says isn't there can never be posted. Any other signing
    // failure may be a passing fault, so it uses an attempt.
    const signed = await signVideo(admin, row.videoPath);
    if ('missing' in signed) {
      patch = { ...MISSING };
      return 'failed';
    }
    if ('failed' in signed) {
      console.error('Could not sign a YouTube video:', signed.failed);
      return countError(UNSIGNED);
    }
    const signedUrl = signed.url;

    const outcome: UploadOutcome = await runUpload(row, accessToken, opts.deadline, {
      readRange: rangeReader(signedUrl, fetch),
      fetch,
      now: Date.now,
      async save(progress) {
        await saveUpload(admin, row.id, progress);
        if (progress.uploadUrl !== undefined) session = progress.uploadUrl;
      },
    });

    switch (outcome.kind) {
      case 'done':
        patch = { status: 'published', youtube_id: outcome.youtubeId, published_privacy: outcome.privacy, published_at: new Date().toISOString(), error: null, upload_url: null };
        return 'published';
      case 'partial':
      case 'restart':
        return 'partial';
      case 'reconnect':
        await markYouTubeReconnect(admin, userId);
        patch = pause();
        return 'reconnect';
      case 'quota': {
        // Set first, so the row goes back to the queue even if the hold can't be saved.
        patch = { ...BACK_IN_QUEUE, error: QUOTA_MESSAGE };
        const schedule = await getSchedule(admin, userId);
        await setHold(admin, userId, nextDayStart(opts.now, schedule.timezone).toISOString());
        return 'held';
      }
      case 'missing':
        patch = { ...MISSING };
        return 'failed';
      case 'error':
        return countError(outcome.message);
      default: {
        const unknown: never = outcome;
        throw new Error(`Unknown upload outcome ${JSON.stringify(unknown)}`);
      }
    }
  } finally {
    await release(admin, row.id, patch);
    if (patch.status === 'published') {
      // Bookkeeping only: the video is on YouTube whatever happens here.
      try {
        await recordYouTubePublish(admin, userId);
      } catch (error) {
        console.error('Could not record the YouTube publish time', error);
      }
    }
  }
}

/**
 * Before Retry puts a failed row back in the queue: if it kept an upload session,
 * ask that session whether YouTube already has the whole video. 'published' means
 * it did, and the row is now marked published; 'requeue' means upload it again,
 * as Retry always has (no session, or the session answered without the video).
 * When the session can't be asked at all, the row is left as it is, session kept:
 * 'reconnect' (no YouTube sign-in) or 'unavailable' (Google or storage didn't answer).
 */
export async function settleFailedRow(
  admin: Admin,
  userId: string,
  id: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<'published' | 'requeue' | 'reconnect' | 'unavailable'> {
  const fetchImpl = deps.fetch ?? timedFetch;
  const row = await failedRow(admin, userId, id);
  if (!row?.uploadUrl || !ownPath(userId, row.videoPath)) return 'requeue';

  const refreshToken = await getYouTubeRefreshToken(admin, userId);
  if (!refreshToken) return 'reconnect';
  let accessToken: string;
  try {
    accessToken = await mintAccessToken(refreshToken, fetchImpl);
  } catch (error) {
    if (error instanceof YouTubeAuthError && error.reconnect) {
      await markYouTubeReconnect(admin, userId);
      return 'reconnect';
    }
    return 'unavailable';
  }

  const signed = await signVideo(admin, row.videoPath);
  if (!('url' in signed)) return 'unavailable';

  const answer = await askSession(row.uploadUrl, accessToken, row, {
    readRange: rangeReader(signed.url, fetchImpl),
    fetch: fetchImpl,
    now: Date.now,
    save: async () => {},
  });
  if (answer.kind !== 'done') return 'requeue';
  // Someone else settled it first: it is published either way, so nothing is uploaded again.
  if (!(await settlePublished(admin, userId, id, { youtubeId: answer.youtubeId, privacy: answer.privacy }))) return 'published';
  try {
    await recordYouTubePublish(admin, userId);
  } catch (error) {
    console.error('Could not record the YouTube publish time', error);
  }
  return 'published';
}

/** Stop starting new people with less than this left: a sign-in, then room for at least one timed request. */
const MIN_SLICE_MS = REQUEST_TIMEOUT_MS + 5_000;

/** The cron's run: a slice for each person with work, while time lasts (R1). */
export async function publishDue(admin: Admin, now: Date, deadline: number): Promise<{ users: number; published: number; partial: number; errors: number }> {
  const counts = { users: 0, published: 0, partial: 0, errors: 0 };
  for (const userId of await usersWithWork(admin)) {
    if (deadline - Date.now() < MIN_SLICE_MS) break;
    try {
      // One person at a time: each slice uses the time that is left.
      const result = await publishSlice(admin, userId, { postedBy: 'schedule', deadline, now }); // NOSONAR: sequential on purpose
      if (result === 'none') continue;
      counts.users += 1;
      if (result === 'published') counts.published += 1;
      if (result === 'partial') counts.partial += 1;
    } catch (error) {
      counts.errors += 1;
      console.error('A YouTube publish slice failed', error);
    }
  }
  return counts;
}
