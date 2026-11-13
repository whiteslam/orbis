import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { getPersonSettingsAdmin } from '@/lib/locale/repository';
import { isMissingTable } from '@/lib/supabase/errors';
import { defaultPreset } from '@/lib/youtube/details';
import { QUEUE_COLUMNS, defaultSchedule, readPresetRow, readQueueItem, readQueueRow, readScheduleRow, type QueueRowFull } from '@/lib/youtube/rows';
import type { Preset, QueueItem, Schedule, VideoDetails } from '@/lib/youtube/types';

// The YouTube tables (supabase/migrations/202611130002_youtube.sql). Only the
// service role writes them, so every function takes the admin client from its
// caller: a server action that has checked who is asking, or the publish cron
// working through each person's own rows. Every query is keyed to that user id.
// Reads that find the tables missing (migration not applied) give empty or
// default values; writes throw a message safe to show.

type Admin = ReturnType<typeof createAdminClient>;

/** An error whose message is safe to show as-is. */
export class YouTubeQueueError extends Error {}

/** How long one slice may hold a row. Longer than a request can run (60 s), so a crashed slice frees it soon after. */
export const LEASE_SECONDS = 75;

const SETUP_MESSAGE = 'YouTube publishing isn’t set up yet. Try again in a little while.';
const SAVE_MESSAGE = 'That couldn’t be saved. Try again in a little while.';
export const ALREADY_QUEUED = 'This short is already in your YouTube queue.';

const ACTIVE = ['queued', 'uploading'];

function failed(error: { code?: string; message?: string }, message = SAVE_MESSAGE) {
  if (!isMissingTable(error)) console.error(message, error);
  return new YouTubeQueueError(isMissingTable(error) ? SETUP_MESSAGE : message);
}

function readFailed(error: { code?: string; message?: string }, what: string) {
  if (!isMissingTable(error)) console.error(`Could not read ${what}`, error);
}

const detailsColumns = (details: VideoDetails) => ({
  title: details.title,
  description: details.description,
  tags: details.tags,
  category_id: details.categoryId,
  privacy: details.privacy,
  made_for_kids: details.madeForKids,
});

const SCHEDULE_COLUMNS = 'post_time,days,timezone,paused,hold_until';

/** The person's schedule. The first read creates it in their own time zone (R2). */
export async function getSchedule(admin: Admin, userId: string): Promise<Schedule> {
  const read = () => admin.from('youtube_settings').select(SCHEDULE_COLUMNS).eq('user_id', userId).maybeSingle();
  const { data, error } = await read();
  if (error) {
    readFailed(error, 'youtube_settings');
    return defaultSchedule('Asia/Kolkata');
  }
  if (data) return readScheduleRow(data, 'Asia/Kolkata');

  const { timeZone } = await getPersonSettingsAdmin(admin, userId);
  const fresh = defaultSchedule(timeZone);
  // Two first reads at once: the second insert is ignored and both read the same row.
  const { error: insertError } = await admin
    .from('youtube_settings')
    .upsert({ user_id: userId, post_time: fresh.postTime, days: fresh.days, timezone: fresh.timezone, paused: false }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (insertError) {
    readFailed(insertError, 'youtube_settings (create)');
    return fresh;
  }
  const again = await read();
  return again.data ? readScheduleRow(again.data, timeZone) : fresh;
}

/** Saves when and whether to post. The quota hold is the publisher's alone and is left as it is. */
export async function saveSchedule(admin: Admin, userId: string, schedule: Omit<Schedule, 'holdUntil'>): Promise<void> {
  const { error } = await admin.from('youtube_settings').upsert(
    { user_id: userId, post_time: schedule.postTime, days: schedule.days, timezone: schedule.timezone, paused: schedule.paused },
    { onConflict: 'user_id' },
  );
  if (error) throw failed(error);
}

/** Nothing is due before this instant (R5). */
export async function setHold(admin: Admin, userId: string, holdUntil: string): Promise<void> {
  const { error } = await admin.from('youtube_settings').update({ hold_until: holdUntil }).eq('user_id', userId);
  if (error) throw failed(error);
}

/** The person's defaults for one style. The first read stores the built-in ones. */
export async function getPreset(admin: Admin, userId: string, style: string): Promise<Preset> {
  const { data, error } = await admin
    .from('youtube_presets')
    .select('privacy,category_id,made_for_kids,tags')
    .eq('user_id', userId)
    .eq('style', style)
    .maybeSingle();
  if (error) {
    readFailed(error, 'youtube_presets');
    return defaultPreset(style);
  }
  if (data) return readPresetRow(data, style);
  const preset = defaultPreset(style);
  const { error: insertError } = await admin.from('youtube_presets').upsert(
    { user_id: userId, style, privacy: preset.privacy, category_id: preset.categoryId, made_for_kids: preset.madeForKids, tags: preset.tags },
    { onConflict: 'user_id,style', ignoreDuplicates: true },
  );
  if (insertError) readFailed(insertError, 'youtube_presets (create)');
  return preset;
}

/** Waiting and in-flight rows, first to post first. */
export async function listQueue(admin: Admin, userId: string): Promise<QueueItem[]> {
  const { data, error } = await admin
    .from('youtube_queue')
    .select(QUEUE_COLUMNS)
    .eq('user_id', userId)
    .in('status', ACTIVE)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    readFailed(error, 'youtube_queue');
    return [];
  }
  return (data ?? []).map(readQueueItem).filter((item): item is QueueItem => item !== null);
}

/** Posted and failed rows, newest first. */
export async function listPosted(admin: Admin, userId: string, limit = 20): Promise<QueueItem[]> {
  const { data, error } = await admin
    .from('youtube_queue')
    .select(QUEUE_COLUMNS)
    .eq('user_id', userId)
    .in('status', ['published', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    readFailed(error, 'youtube_queue');
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const when = (row: Record<string, unknown>) => Date.parse(String(row.published_at ?? row.updated_at ?? '')) || 0;
  return [...rows]
    .sort((a, b) => when(b) - when(a))
    .map(readQueueItem)
    .filter((item): item is QueueItem => item !== null);
}

/** Adds a short at the back of the queue. */
export async function insertQueued(
  admin: Admin,
  userId: string,
  input: { jobId: string | null; videoPath: string; coverPath: string | null } & VideoDetails,
): Promise<QueueItem> {
  const last = await admin.from('youtube_queue').select('position').eq('user_id', userId).order('position', { ascending: false }).limit(1);
  if (last.error) throw failed(last.error);
  const top = (last.data ?? [])[0] as { position?: unknown } | undefined;
  const position = typeof top?.position === 'number' ? top.position + 1 : 1;

  const { data, error } = await admin
    .from('youtube_queue')
    .insert({ user_id: userId, job_id: input.jobId, video_path: input.videoPath, cover_path: input.coverPath, position, status: 'queued', ...detailsColumns(input) })
    .select(QUEUE_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') throw new YouTubeQueueError(ALREADY_QUEUED);
    throw failed(error);
  }
  const item = readQueueItem(data);
  if (!item) throw new YouTubeQueueError(SAVE_MESSAGE);
  return item;
}

/** New details for a row still waiting. Any upload session was opened with the old ones, so it is dropped. */
export async function updateQueued(admin: Admin, userId: string, id: string, details: VideoDetails): Promise<boolean> {
  const { data, error } = await admin
    .from('youtube_queue')
    .update({ ...detailsColumns(details), upload_url: null, bytes_sent: 0 })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('status', 'queued')
    .select('id');
  if (error) throw failed(error);
  return (data ?? []).length > 0;
}

/** Swaps a waiting row with its neighbour: -1 earlier, 1 later. */
export async function moveQueued(admin: Admin, userId: string, id: string, dir: -1 | 1): Promise<void> {
  const { error } = await admin.rpc('youtube_move', { p_user: userId, p_id: id, p_dir: dir });
  if (error) throw failed(error);
}

export async function removeQueued(admin: Admin, userId: string, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('youtube_queue')
    .update({ status: 'removed' })
    .eq('user_id', userId)
    .eq('id', id)
    .in('status', ['queued', 'failed'])
    .select('id');
  if (error) throw failed(error);
  return (data ?? []).length > 0;
}

/** Puts a failed row back at the front of the queue with fresh attempts. */
export async function retryFailed(admin: Admin, userId: string, id: string): Promise<boolean> {
  const first = await admin.from('youtube_queue').select('position').eq('user_id', userId).eq('status', 'queued').order('position', { ascending: true }).limit(1);
  if (first.error) throw failed(first.error);
  const head = (first.data ?? [])[0] as { position?: unknown } | undefined;
  const position = (typeof head?.position === 'number' ? head.position : 1) - 1;
  const { data, error } = await admin
    .from('youtube_queue')
    .update({ status: 'queued', attempts: 0, error: null, position, upload_url: null, bytes_sent: 0 })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('status', 'failed')
    .select('id');
  if (error) throw failed(error);
  return (data ?? []).length > 0;
}

/**
 * Takes a row for one slice (R3): one guarded update in SQL, so of two runs
 * racing for the same row only one gets it back. Starting (from 'queued') marks
 * it uploading and records who posted it.
 */
export async function takeRow(
  admin: Admin,
  userId: string,
  id: string,
  from: 'queued' | 'uploading',
  postedBy?: 'schedule' | 'manual',
): Promise<QueueRowFull | null> {
  const { data, error } = await admin.rpc('youtube_take_row', {
    p_user: userId,
    p_id: id,
    p_from: from,
    p_posted_by: postedBy ?? null,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    readFailed(error, 'youtube_take_row');
    return null;
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.length ? readQueueRow(rows[0]) : null;
}

/** Saves upload progress during a slice. */
export async function saveUpload(admin: Admin, id: string, patch: { uploadUrl?: string | null; bytesSent?: number }): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.uploadUrl !== undefined) update.upload_url = patch.uploadUrl;
  if (patch.bytesSent !== undefined) update.bytes_sent = patch.bytesSent;
  if (!Object.keys(update).length) return;
  const { error } = await admin.from('youtube_queue').update(update).eq('id', id);
  if (error) throw failed(error);
}

/** Ends a slice: applies its result and frees the row. A failure is logged; the lease runs out on its own. */
export async function release(admin: Admin, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('youtube_queue').update({ ...patch, lease_until: null }).eq('id', id);
  if (error) console.error('Could not release a YouTube queue row', error);
}

/** An in-flight row no one holds, to finish before anything else (R4). */
export async function uploadingRowId(admin: Admin, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('youtube_queue')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'uploading')
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order('position', { ascending: true })
    .limit(1);
  if (error) {
    readFailed(error, 'youtube_queue');
    return null;
  }
  const row = (data ?? [])[0] as { id?: unknown } | undefined;
  return typeof row?.id === 'string' ? row.id : null;
}

/**
 * When the schedule last used its daily slot: its latest published row, or its
 * latest row that failed for good (at the time it failed). Either way the next
 * row waits for the next posting day. A manual post doesn't count.
 */
export async function lastScheduledAt(admin: Admin, userId: string): Promise<string | null> {
  const [published, failedRow] = await Promise.all([
    admin
      .from('youtube_queue')
      .select('published_at')
      .eq('user_id', userId)
      .eq('status', 'published')
      .eq('posted_by', 'schedule')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1),
    admin
      .from('youtube_queue')
      .select('updated_at')
      .eq('user_id', userId)
      .eq('status', 'failed')
      .eq('posted_by', 'schedule')
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);
  const times: string[] = [];
  for (const [result, column] of [[published, 'published_at'], [failedRow, 'updated_at']] as const) {
    if (result.error) {
      readFailed(result.error, 'youtube_queue');
      continue;
    }
    const value = ((result.data ?? [])[0] as Record<string, unknown> | undefined)?.[column];
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) times.push(value);
  }
  if (!times.length) return null;
  return times.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
}

const USER_CHUNK = 100;

/**
 * Everyone with a row waiting or in flight and a working YouTube connection
 * (R1): people with an upload to finish first, then by their oldest waiting row.
 */
export async function usersWithWork(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from('youtube_queue').select('user_id,status,created_at').in('status', ACTIVE).order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error('Could not read the YouTube queue.');
  }
  const rows = (data ?? []) as { user_id: string; status: string }[];
  const finishing = rows.filter((row) => row.status === 'uploading').map((row) => row.user_id);
  const ordered = [...new Set([...finishing, ...rows.map((row) => row.user_id)])];
  if (!ordered.length) return [];

  const connected = new Set<string>();
  for (let start = 0; start < ordered.length; start += USER_CHUNK) {
    const { data: links, error: linkError } = await admin
      .from('social_connections')
      .select('user_id')
      .eq('platform', 'youtube')
      .eq('status', 'connected')
      .in('user_id', ordered.slice(start, start + USER_CHUNK)); // NOSONAR: a few chunks, one after another
    if (linkError) {
      if (isMissingTable(linkError)) return [];
      throw new Error('Could not read the YouTube connections.');
    }
    for (const link of links ?? []) connected.add(String(link.user_id));
  }
  return ordered.filter((id) => connected.has(id));
}
