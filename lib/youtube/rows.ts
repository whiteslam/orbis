// Database rows → the YouTube shapes. Client-safe. The person edits these
// columns only through cleaned actions, but a row read back is still checked:
// anything that doesn't fit reads as a safe default or as no row at all.

import { defaultPreset } from './details';
import type { Preset, Privacy, QueueItem, QueueStatus, Schedule } from './types';

type Row = Record<string, unknown>;

/** A queue row as the publisher needs it: what the screens see plus the upload session. */
export type QueueRowFull = QueueItem & { uploadUrl: string | null };

export const QUEUE_COLUMNS =
  'id,job_id,video_path,cover_path,title,description,tags,category_id,privacy,made_for_kids,position,status,upload_url,bytes_sent,youtube_id,published_privacy,published_at,posted_by,error,attempts,updated_at';

const PRIVACIES: readonly Privacy[] = ['public', 'unlisted', 'private'];
const STATUSES: readonly QueueStatus[] = ['queued', 'uploading', 'published', 'failed', 'removed'];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);
const privacyOf = (value: unknown): Privacy | null => PRIVACIES.find((one) => one === value) ?? null;
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const count = (value: unknown) => {
  // bigint columns can arrive as strings.
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : 0;
};
// Positions go below zero when a failed row is retried at the front.
const integer = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : 0);

/** The schedule a person starts with, in their own zone. */
export function defaultSchedule(timezone: string): Schedule {
  return { postTime: '18:00', days: [...ALL_DAYS], timezone, paused: false, holdUntil: null };
}

export function readScheduleRow(row: unknown, fallbackZone: string): Schedule {
  if (!isRow(row)) return defaultSchedule(fallbackZone);
  const time = /^(\d{2}):(\d{2})/.exec(text(row.post_time));
  const days = Array.isArray(row.days) ? row.days.map(Number).filter((day) => ALL_DAYS.includes(day)) : [];
  return {
    postTime: time ? `${time[1]}:${time[2]}` : '18:00',
    days: days.length ? [...new Set(days)].sort((a, b) => a - b) : [...ALL_DAYS],
    timezone: textOrNull(row.timezone) ?? fallbackZone,
    paused: row.paused === true,
    holdUntil: textOrNull(row.hold_until),
  };
}

export function readPresetRow(row: unknown, style: string): Preset {
  const fallback = defaultPreset(style);
  if (!isRow(row)) return fallback;
  return {
    style,
    privacy: privacyOf(row.privacy) ?? fallback.privacy,
    categoryId: typeof row.category_id === 'string' && /^\d{1,3}$/.test(row.category_id) ? row.category_id : fallback.categoryId,
    madeForKids: row.made_for_kids === true,
    tags: strings(row.tags),
  };
}

/** A queue row for the screens: no upload session in it. */
export function readQueueItem(row: unknown): QueueItem | null {
  if (!isRow(row) || typeof row.id !== 'string' || !STATUSES.includes(row.status as QueueStatus)) return null;
  const privacy = privacyOf(row.privacy);
  if (!privacy) return null;
  return {
    id: row.id,
    jobId: textOrNull(row.job_id),
    videoPath: text(row.video_path),
    coverPath: textOrNull(row.cover_path),
    title: text(row.title),
    description: text(row.description),
    tags: strings(row.tags),
    categoryId: text(row.category_id),
    privacy,
    madeForKids: row.made_for_kids === true,
    position: integer(row.position),
    status: row.status as QueueStatus,
    bytesSent: count(row.bytes_sent),
    youtubeId: textOrNull(row.youtube_id),
    publishedPrivacy: privacyOf(row.published_privacy),
    publishedAt: textOrNull(row.published_at),
    postedBy: row.posted_by === 'schedule' || row.posted_by === 'manual' ? row.posted_by : null,
    error: textOrNull(row.error),
    attempts: count(row.attempts),
  };
}

/** The same row with its upload session, for the publisher. */
export function readQueueRow(row: unknown): QueueRowFull | null {
  const item = readQueueItem(row);
  return item && isRow(row) ? { ...item, uploadUrl: textOrNull(row.upload_url) } : null;
}
