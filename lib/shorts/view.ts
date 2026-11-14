// What the Shorts screens receive from their server actions. Client-safe.

import type { QueueStatus } from '@/lib/youtube/types';
import type { ShortEvent, ShortJob, ShortStyle, WorkerPresence, WorkerState } from '@/lib/shorts/types';

export type Result<T> = { success: true; data: T } | { success: false; message: string };

export type StyleCard = ShortStyle & { sheetUrl: string | null };

export type ShortsView = {
  presence: WorkerPresence;
  worker: WorkerState | null;
  styles: StyleCard[];
  jobs: ShortJob[];
  /** Signed cover URLs for finished shorts, by job id. */
  covers: Record<string, string>;
  /** Shorts started this month (India), against LIMITS.perMonth. */
  monthUsed: number;
  /** Where a short stands in the YouTube queue (waiting, uploading, on YouTube), by job id. Empty when YouTube isn’t set up. */
  youtube: Record<string, { status: QueueStatus; youtubeId: string | null }>;
};

export type JobDetail = {
  job: ShortJob;
  /** Only the events after the `afterSeq` asked for. */
  events: ShortEvent[];
};

/** Signed URLs (one hour) for a finished short's files. */
export type ShortFiles = { video: string; share: string | null; cover: string | null; sheet: string | null };
