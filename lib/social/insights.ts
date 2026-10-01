import 'server-only';

import { getSocialToken, markSocialReconnect } from '@/lib/social/connections';
import type { SocialPlatformId } from '@/lib/social/meta';
import {
  INSTAGRAM_METRICS,
  THREADS_METRICS,
  THREADS_POST_METRICS,
  WINDOW_DAYS,
  labelled,
  metaErrorKind,
  metricValue,
  shortText,
  type InsightPost,
  type MetaErrorKind,
  type PlatformInsights,
} from '@/lib/social/insights-shape';

/**
 * Reads a connected account's numbers straight from Meta, on demand.
 *
 * Every account metric is its own request. Meta rejects a whole request over
 * one metric it has renamed or retired (Instagram swapped impressions for
 * views in 2025), and one bad name should cost one tile, not the panel.
 * Nothing is stored: these are Meta's numbers, read with the user's token,
 * shown once.
 */
const INSTAGRAM = 'https://graph.instagram.com/v21.0';
const THREADS = 'https://graph.threads.net/v1.0';
const RECENT = 6;

type Answer = { ok: true; body: unknown } | { ok: false; kind: MetaErrorKind };

async function ask(url: string, token: string): Promise<Answer> {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || (body as { error?: unknown }).error) return { ok: false, kind: metaErrorKind(body) };
    return { ok: true, body };
  } catch {
    return { ok: false, kind: 'other' };
  }
}

const field = <T>(answer: Answer, read: (body: Record<string, unknown>) => T): T | null => (answer.ok ? read(answer.body as Record<string, unknown>) : null);
const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function windowQuery() {
  const until = Math.floor(Date.now() / 1000);
  return `since=${until - WINDOW_DAYS * 86_400}&until=${until}`;
}

/** Collects one metric per request; reports whether any refusal was about permission. */
async function metrics(spec: Array<[string, string]>, url: (metric: string) => string, token: string) {
  const answers = await Promise.all(spec.map(async ([key]) => [key, await ask(url(key), token)] as const));
  const values = new Map(answers.map(([key, answer]) => [key, answer.ok ? metricValue(answer.body, key) : null]));
  return { totals: labelled(spec, values), blocked: answers.some(([, answer]) => !answer.ok && answer.kind === 'permission') };
}

async function instagram(token: string, accountId: string): Promise<PlatformInsights> {
  const profile = await ask(`${INSTAGRAM}/me?fields=user_id,username,followers_count,media_count`, token);
  if (!profile.ok && profile.kind === 'token') return { platform: 'instagram', state: 'reconnect', message: 'Instagram access has expired.' };

  const window = windowQuery();
  const [account, media] = await Promise.all([
    metrics(INSTAGRAM_METRICS, (metric) => `${INSTAGRAM}/${accountId}/insights?metric=${metric}&period=day&metric_type=total_value&${window}`, token),
    ask(`${INSTAGRAM}/${accountId}/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=${RECENT}`, token),
  ]);

  const rows = field(media, (body) => (Array.isArray(body.data) ? body.data as Array<Record<string, unknown>> : [])) ?? [];
  const recent: InsightPost[] = rows.map((item) => ({
    id: String(item.id),
    text: shortText(item.caption),
    permalink: text(item.permalink),
    timestamp: text(item.timestamp),
    // A video's media_url is the video itself; its still is thumbnail_url.
    thumbnail: text(item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url) ?? text(item.thumbnail_url),
    metrics: labelled([['likes', 'Likes'], ['comments', 'Comments']], new Map([['likes', num(item.like_count)], ['comments', num(item.comments_count)]])),
  }));

  return {
    platform: 'instagram',
    state: 'ready',
    username: field(profile, (body) => text(body.username)),
    followers: field(profile, (body) => num(body.followers_count)),
    totals: account.totals,
    insightsBlocked: account.blocked && !account.totals.length,
    recent,
    windowDays: WINDOW_DAYS,
  };
}

async function threads(token: string, accountId: string): Promise<PlatformInsights> {
  const profile = await ask(`${THREADS}/me?fields=id,username`, token);
  if (!profile.ok && profile.kind === 'token') return { platform: 'threads', state: 'reconnect', message: 'Threads access has expired.' };

  const window = windowQuery();
  const [account, followers, list] = await Promise.all([
    metrics(THREADS_METRICS, (metric) => `${THREADS}/${accountId}/threads_insights?metric=${metric}&${window}`, token),
    // A running total: Meta ignores the window for it.
    ask(`${THREADS}/${accountId}/threads_insights?metric=followers_count`, token),
    ask(`${THREADS}/${accountId}/threads?fields=id,text,permalink,timestamp,media_type,media_url,thumbnail_url&limit=${RECENT * 2}`, token),
  ]);

  // Reposts of other people's threads show up in the list but have no insights of their own.
  const rows = (field(list, (body) => (Array.isArray(body.data) ? body.data as Array<Record<string, unknown>> : [])) ?? [])
    .filter((item) => item.media_type !== 'REPOST_FACADE')
    .slice(0, RECENT);
  const postMetrics = THREADS_POST_METRICS.map(([key]) => key).join(',');
  const recent: InsightPost[] = await Promise.all(rows.map(async (item) => {
    const insight = await ask(`${THREADS}/${String(item.id)}/insights?metric=${postMetrics}`, token);
    const values = new Map(THREADS_POST_METRICS.map(([key]) => [key, insight.ok ? metricValue(insight.body, key) : null]));
    return {
      id: String(item.id),
      text: shortText(item.text),
      permalink: text(item.permalink),
      timestamp: text(item.timestamp),
      thumbnail: text(item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url),
      metrics: labelled(THREADS_POST_METRICS, values),
    };
  }));

  return {
    platform: 'threads',
    state: 'ready',
    username: field(profile, (body) => text(body.username)),
    followers: followers.ok ? metricValue(followers.body, 'followers_count') : null,
    totals: account.totals,
    insightsBlocked: (account.blocked || (!followers.ok && followers.kind === 'permission')) && !account.totals.length,
    recent,
    windowDays: WINDOW_DAYS,
  };
}

/** The numbers for one platform, or why there are none. */
export async function loadPlatformInsights(userId: string, platform: SocialPlatformId): Promise<PlatformInsights> {
  const token = await getSocialToken(userId, platform);
  if (!token) return { platform, state: 'not-connected' };
  const result = platform === 'instagram' ? await instagram(token.accessToken, token.accountId) : await threads(token.accessToken, token.accountId);
  // Keep Settings honest: a token Meta has revoked shows there as needing a reconnect too.
  if (result.state === 'reconnect') await markSocialReconnect(userId, platform);
  return result;
}
