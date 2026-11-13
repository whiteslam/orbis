import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { signPaths } from '@/lib/shorts/repository';
import { getYouTubeRefreshToken, markYouTubeReconnect, recordYouTubePublish } from '@/lib/youtube/connection';
import { MAX_ATTEMPTS } from '@/lib/youtube/details';
import { mintAccessToken, YouTubeAuthError } from '@/lib/youtube/google';
import { getSchedule, lastScheduledAt, listQueue, release, saveUpload, setHold, takeRow, uploadingRowId, usersWithWork } from '@/lib/youtube/repository';
import type { QueueRowFull } from '@/lib/youtube/rows';
import { isDue, nextDayStart } from '@/lib/youtube/schedule';
import { rangeReader, REQUEST_TIMEOUT_MS, runUpload, type UploadOutcome } from '@/lib/youtube/upload';

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

  const schedule = await getSchedule(admin, userId);
  if (!isDue(schedule, opts.now, await lastScheduledAt(admin, userId))) return null;
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
  let bytesSent = row.bytesSent;
  // An upload that hasn't sent anything goes back to the queue; one part-way through stays to be finished.
  const pause = () => (bytesSent === 0 ? { ...BACK_IN_QUEUE } : {});
  // An attempt used up: back to the queue from scratch, or failed after the last one.
  const countError = (message: string): SliceResult => {
    const attempts = row.attempts + 1;
    const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
    patch = { status, attempts, error: message, upload_url: null, bytes_sent: 0 };
    return status === 'failed' ? 'failed' : 'retry';
  };
  try {
    // A path outside the person's own folder can never be sent.
    if (!ownPath(userId, row.videoPath)) {
      patch = { status: 'failed', error: MISSING_MESSAGE, upload_url: null, bytes_sent: 0 };
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

    // A path that won't sign may be a passing fault, so it uses an attempt rather than failing at once.
    const signedUrl = (await signPaths(admin, [row.videoPath])).get(row.videoPath);
    if (!signedUrl) return countError(UNSIGNED);

    const outcome: UploadOutcome = await runUpload(row, accessToken, opts.deadline, {
      readRange: rangeReader(signedUrl, fetch),
      fetch,
      now: Date.now,
      async save(progress) {
        await saveUpload(admin, row.id, progress);
        if (progress.bytesSent !== undefined) bytesSent = progress.bytesSent;
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
        patch = { status: 'failed', error: MISSING_MESSAGE, upload_url: null, bytes_sent: 0 };
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
