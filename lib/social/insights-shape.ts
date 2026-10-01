// What the Social tab shows about a connected Instagram or Threads account,
// and the pure half of reading it: Meta's answers in, one shape out.
//
// Meta reports the same kind of number two ways. Account totals come back as
// { total_value: { value } }; time series and per-post insights come back as
// { values: [{ value }, …] }, a day at a time. Both are summed here so the
// screen never has to know which it got. Kept free of server imports so it can
// be unit tested.

// Same as SocialPlatformId in meta.ts, which is server-only and so can't be imported by tests.
type SocialPlatformId = 'instagram' | 'threads';

export type InsightMetric = { key: string; label: string; value: number };

export type InsightPost = {
  id: string;
  text: string;
  permalink: string | null;
  timestamp: string | null;
  thumbnail: string | null;
  metrics: InsightMetric[];
};

export type PlatformInsights =
  | { platform: SocialPlatformId; state: 'not-connected' }
  | { platform: SocialPlatformId; state: 'reconnect'; message: string }
  | {
      platform: SocialPlatformId;
      state: 'ready';
      username: string | null;
      followers: number | null;
      /** Account totals over the window; empty when insights are not allowed. */
      totals: InsightMetric[];
      /** True when Meta refused the insights permission: reconnecting grants it. */
      insightsBlocked: boolean;
      recent: InsightPost[];
      windowDays: number;
    };

export const WINDOW_DAYS = 28;

/** Account-level metrics, in the order they are shown. */
export const INSTAGRAM_METRICS: Array<[string, string]> = [
  ['views', 'Views'],
  ['reach', 'Accounts reached'],
  ['accounts_engaged', 'Accounts engaged'],
  ['total_interactions', 'Interactions'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['saves', 'Saves'],
];

export const THREADS_METRICS: Array<[string, string]> = [
  ['views', 'Views'],
  ['likes', 'Likes'],
  ['replies', 'Replies'],
  ['reposts', 'Reposts'],
  ['quotes', 'Quotes'],
];

export const THREADS_POST_METRICS: Array<[string, string]> = [
  ['views', 'Views'],
  ['likes', 'Likes'],
  ['replies', 'Replies'],
  ['reposts', 'Reposts'],
];

type MetricRow = { name?: unknown; total_value?: { value?: unknown }; values?: Array<{ value?: unknown }> };

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** One metric's number from an insights answer, whichever way Meta wrote it. */
export function metricValue(body: unknown, name: string): number | null {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  const row = (rows as MetricRow[]).find((item) => item?.name === name);
  if (!row) return null;
  const total = count(row.total_value?.value);
  if (total !== null) return total;
  if (!Array.isArray(row.values)) return null;
  const parts = row.values.map((item) => count(item?.value)).filter((value): value is number => value !== null);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
}

/** Labelled metrics in display order, leaving out any Meta did not answer. */
export function labelled(spec: Array<[string, string]>, values: Map<string, number | null>): InsightMetric[] {
  return spec.flatMap(([key, label]) => {
    const value = values.get(key);
    return typeof value === 'number' ? [{ key, label, value }] : [];
  });
}

export type MetaErrorKind = 'token' | 'permission' | 'other';

/**
 * Why Meta said no. 190 is a dead or revoked token: only reconnecting helps.
 * 10 and the 200 range are a missing permission, which reconnecting with the
 * insights scope fixes. Anything else is a metric or a moment Meta did not like.
 */
export function metaErrorKind(body: unknown): MetaErrorKind {
  const error = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  const code = typeof error?.code === 'number' ? error.code : null;
  if (code === 190) return 'token';
  if (code === 10 || (code !== null && code >= 200 && code < 300)) return 'permission';
  return 'other';
}

/** A caption cut to one readable line. */
export function shortText(text: unknown, max = 90) {
  const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Compact counts: 950, 1.2K, 34K, 1.5M. */
export function compactCount(value: number) {
  if (value < 1000) return String(Math.round(value));
  const [divisor, suffix] = value < 1_000_000 ? [1000, 'K'] : [1_000_000, 'M'];
  const scaled = value / divisor;
  return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${suffix}`;
}

const META_CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

/**
 * True only for an https image on Meta's own CDNs. The thumbnail route fetches
 * whatever passes this on the server's behalf, so anything looser would make
 * it a proxy to the rest of the internet.
 */
export function isMetaCdnUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && META_CDN.test(url.hostname);
  } catch {
    return false;
  }
}

/** Thumbnails go through Orbis: Meta's CDN refuses to be shown on other sites (Cross-Origin-Resource-Policy). */
export const thumbnailSrc = (url: string) => `/api/social/thumb?u=${encodeURIComponent(url)}`;
