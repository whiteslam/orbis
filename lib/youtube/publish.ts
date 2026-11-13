import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { signPaths } from '@/lib/shorts/repository';
import { getYouTubeRefreshToken, markYouTubeReconnect, recordYouTubePublish } from '@/lib/youtube/connection';
import { MAX_ATTEMPTS } from '@/lib/youtube/details';
import { mintAccessToken, YouTubeAuthError } from '@/lib/youtube/google';
import { getSchedule, lastScheduledAt, listQueue, release, saveUpload, setHold, takeRow, uploadingRowId, usersWithWork } from '@/lib/youtube/repository';
import type { QueueRowFull } from '@/lib/youtube/rows';
import { isDue, nextDayStart } from '@/lib/youtube/schedule';
import { rangeReader, runUpload, type UploadOutcome } from '@/lib/youtube/upload';

// Posting to YouTube, one slice at a time (spec: "Publishing run", rulings
// R1–R5). A slice takes one row under a lease, sends what it can before the
// deadline, and always lets the row go again. The cron calls publishDue for
// everyone with work; Post now calls publishSlice for one person and one row.

type Admin = ReturnType<typeof createAdminClient>;

export type SliceResult = 'none' | 'partial' | 'published' | 'held' | 'reconnect' | 'failed' | 'retry';

export const QUOTA_MESSAGE = 'YouTube’s daily upload limit was reached. Trying again on the next posting day.';
export const MISSING_MESSAGE = 'video file missing';
const GOOGLE_DOWN = 'Google couldn’t be reached to sign in. Trying again soon.';

/** Back in the queue as if never started: a queued row never keeps an upload session. */
const BACK_IN_QUEUE = { status: 'queued', upload_url: null, bytes_sent: 0 } as const;

type SliceOptions = { rowId?: string; postedBy: 'schedule' | 'manual'; deadline: number; now: Date };

/** Which row this slice works on, taken under a lease, or null when there is nothing to do. */
async function pick(admin: Admin, userId: string, opts: SliceOptions): Promise<QueueRowFull | null> {
  // R4: an upload already under way is finished first, due or not.
  const uploading = await uploadingRowId(admin, userId);
  if (uploading) return takeRow(admin, userId, uploading, 'uploading');
  if (opts.rowId) return takeRow(admin, userId, opts.rowId, 'queued', opts.postedBy);

  const schedule = await getSchedule(admin, userId);
  if (!isDue(schedule, opts.now, await lastScheduledAt(admin, userId))) return null;
  const next = (await listQueue(admin, userId)).find((item) => item.status === 'queued');
  return next ? takeRow(admin, userId, next.id, 'queued', opts.postedBy) : null;
}

/** A signed address for the row's video, only ever inside the person's own folder. */
async function signedVideo(admin: Admin, userId: string, videoPath: string): Promise<string | null> {
  if (!videoPath.startsWith(`${userId}/`) || videoPath.includes('..')) return null;
  return (await signPaths(admin, [videoPath])).get(videoPath) ?? null;
}

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
  try {
    const refreshToken = await getYouTubeRefreshToken(admin, userId);
    if (!refreshToken) {
      await markYouTubeReconnect(admin, userId);
      patch = pause();
      return 'reconnect';
    }

    let accessToken: string;
    try {
      accessToken = await mintAccessToken(refreshToken);
    } catch (error) {
      if (error instanceof YouTubeAuthError && error.reconnect) {
        await markYouTubeReconnect(admin, userId);
        patch = pause();
        return 'reconnect';
      }
      // Google down or the server misconfigured: no attempt is used up.
      console.error('Could not mint a YouTube access token', error instanceof YouTubeAuthError ? error.message : error);
      patch = { ...pause(), error: error instanceof YouTubeAuthError ? error.message : GOOGLE_DOWN };
      return 'retry';
    }

    const signedUrl = await signedVideo(admin, userId, row.videoPath);
    const outcome: UploadOutcome = signedUrl
      ? await runUpload(row, accessToken, opts.deadline, {
          readRange: rangeReader(signedUrl, fetch),
          fetch,
          now: Date.now,
          async save(progress) {
            await saveUpload(admin, row.id, progress);
            if (progress.bytesSent !== undefined) bytesSent = progress.bytesSent;
          },
        })
      : { kind: 'missing' };

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
      case 'error': {
        const attempts = row.attempts + 1;
        const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
        patch = { status, attempts, error: outcome.message, upload_url: null, bytes_sent: 0 };
        return status === 'failed' ? 'failed' : 'retry';
      }
      default: {
        const unknown: never = outcome;
        throw new Error(`Unknown upload outcome ${JSON.stringify(unknown)}`);
      }
    }
  } finally {
    await release(admin, row.id, patch);
    if (patch.status === 'published') await recordYouTubePublish(admin, userId);
  }
}

/** Stop starting new people with less than this left: a slice needs a sign-in, a session and a chunk. */
const MIN_SLICE_MS = 8_000;

/** The cron's run: a slice for each person with work, while time lasts (R1). */
export async function publishDue(admin: Admin, now: Date, deadline: number): Promise<{ users: number; published: number; partial: number }> {
  const counts = { users: 0, published: 0, partial: 0 };
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
      console.error('A YouTube publish slice failed', error);
    }
  }
  return counts;
}
