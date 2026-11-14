// The YouTube publishing shapes the repository, the actions and the screens share.
// Client-safe: types only, no imports.

export type Privacy = 'public' | 'unlisted' | 'private';
export type QueueStatus = 'queued' | 'uploading' | 'published' | 'failed' | 'removed';

export type VideoDetails = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacy: Privacy;
  madeForKids: boolean;
};

/** What a new video starts with for one Shorts style. */
export type Preset = { style: string; privacy: Privacy; categoryId: string; madeForKids: boolean; tags: string[] };

/** How many times a day the schedule can post. */
export const MAX_POST_TIMES = 6;

export type Schedule = {
  /** 'HH:MM' times on the wall clock in `timezone`, earliest first: one post at each, on each listed day. */
  postTimes: string[];
  /** ISO weekdays: Monday is 1, Sunday is 7. */
  days: number[];
  timezone: string;
  paused: boolean;
  /** An ISO instant before which nothing is posted (the quota hold), or null. */
  holdUntil: string | null;
};

export type QueueItem = VideoDetails & {
  id: string;
  jobId: string | null;
  videoPath: string;
  coverPath: string | null;
  position: number;
  status: QueueStatus;
  bytesSent: number;
  youtubeId: string | null;
  publishedPrivacy: Privacy | null;
  publishedAt: string | null;
  postedBy: 'schedule' | 'manual' | null;
  error: string | null;
  attempts: number;
};

export type YouTubeConnection = { channelTitle: string | null; status: 'connected' | 'reconnect_required' } | null;

export type YouTubePanel = {
  configured: boolean;
  ready: boolean;
  connection: YouTubeConnection;
  schedule: Schedule;
  queue: QueueItem[];
  posted: QueueItem[];
  covers: Record<string, string>;
  next: string | null;
};
