// How long a style takes to make on the owner's Shorts PC: measured from the
// shorts already finished in that style, or a rough default by 2D/3D. Pure and
// client-safe.

import type { ShortJob, ShortStyle } from '@/lib/shorts/types';

/** Planning (job created → plan ready) takes about this long; the job row has no plan-ready time to measure it. */
export const PLAN_MINUTES = 3;
/** Only the most recent finished shorts count, so a faster PC shows up soon. */
export const MAX_SAMPLES = 10;
/** A build longer than this is a stuck or paused run, not a measurement. */
const MAX_BUILD_MINUTES = 12 * 60;

/** Rough ranges until a style has been made at least once (3D renders slowly without a graphics card). */
const DEFAULTS = {
  flat: { min: 15, max: 25 },
  depth: { min: 60, max: 120 },
} as const;

export type MakeEstimate = {
  /** Measured from finished shorts, or the default range. */
  measured: boolean;
  /** The finished shorts the estimate is the median of; 0 for a default. */
  samples: number;
  /** Planning plus build, in minutes (the middle of the range for a default). */
  minutes: number;
  /** For the card: "≈ 16 min to make", "usually 15–25 min to make". */
  label: string;
  /** For the details: how the figure was worked out. */
  detail: string;
};

/** "16 min", "2 h", "1.5 h": minutes under an hour, half hours above. */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const halves = Math.round(whole / 30) / 2;
  return `${Number.isInteger(halves) ? halves : halves.toFixed(1)} h`;
}

function formatRange(min: number, max: number): string {
  return min >= 60 ? `${min / 60}–${max / 60} h` : `${min}–${max} min`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Build minutes of one finished short, or null when its times are missing or implausible. */
export function buildMinutes(job: Pick<ShortJob, 'status' | 'startedAt' | 'finishedAt'>): number | null {
  if (job.status !== 'done' || !job.startedAt || !job.finishedAt) return null;
  const ms = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = ms / 60_000;
  return minutes > MAX_BUILD_MINUTES ? null : minutes;
}

/** How long a short in this style takes: the median build of its recent finished shorts plus planning, else a default. */
export function estimateMakeTime(style: Pick<ShortStyle, 'slug' | 'is3d'>, jobs: readonly ShortJob[]): MakeEstimate {
  const builds = jobs
    .filter((job) => job.style === style.slug)
    .map((job) => ({ job, minutes: buildMinutes(job) }))
    .filter((item): item is { job: ShortJob; minutes: number } => item.minutes !== null)
    .sort((a, b) => Date.parse(b.job.finishedAt ?? '') - Date.parse(a.job.finishedAt ?? ''))
    .slice(0, MAX_SAMPLES)
    .map((item) => item.minutes);

  if (builds.length) {
    const minutes = median(builds) + PLAN_MINUTES;
    const shorts = builds.length === 1 ? 'your last short' : `your last ${builds.length} shorts`;
    return {
      measured: true,
      samples: builds.length,
      minutes,
      label: `≈ ${formatMinutes(minutes)} to make`,
      detail: `≈ ${formatMinutes(minutes)}, from ${shorts} in this style on your PC (planning plus build)`,
    };
  }

  const range = style.is3d ? DEFAULTS.depth : DEFAULTS.flat;
  const span = formatRange(range.min, range.max);
  return {
    measured: false,
    samples: 0,
    minutes: (range.min + range.max) / 2,
    label: `usually ${span} to make`,
    detail: style.is3d
      ? `Usually ${span}, a rough guess until you’ve made one: 3D renders slowly on a PC without a graphics card`
      : `Usually ${span}, a rough guess until you’ve made one`,
  };
}

/** The estimate for every style, by slug. */
export function estimatesBySlug(styles: readonly Pick<ShortStyle, 'slug' | 'is3d'>[], jobs: readonly ShortJob[]): Record<string, MakeEstimate> {
  return Object.fromEntries(styles.map((style) => [style.slug, estimateMakeTime(style, jobs)]));
}
