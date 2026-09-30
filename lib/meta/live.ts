import 'server-only';

import { callMeta, MetaError } from '@/lib/meta/client';
import { markReconnect, usableToken, listConnections } from '@/lib/meta/connection';
import { matchPosts, type PlannedPost } from '@/lib/meta/match';
import { completePublication, listPublications, type PublicationRow } from '@/lib/meta/publications';
import { finishProcessing } from '@/lib/meta/publish';
import { mediaInsights, monthMedia } from '@/lib/meta/requests';
import type { LivePost, LiveStats, MetaPlatform, PlatformLive, SocialLive } from '@/lib/meta/types';
import { listMonth } from '@/lib/social/repository';


/** The month as Unix seconds in India time: [1st 00:00, next 1st 00:00). */
function monthRange(period: string) {
  const [year, month] = period.split('-').map(Number);
  const start = Date.UTC(year, month - 1, 1) - 330 * 60_000;
  const end = Date.UTC(year, month, 1) - 330 * 60_000;
  return { since: Math.floor(start / 1000), until: Math.floor(end / 1000) };
}

function statsFrom(json: Record<string, unknown>): LiveStats {
  const values: Record<string, number> = {};
  for (const item of (json.data as Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>) ?? []) {
    const value = item.values?.[0]?.value ?? item.total_value?.value;
    if (item.name && typeof value === 'number') values[item.name] = value;
  }
  return {
    views: values.views, reach: values.reach, likes: values.likes, comments: values.comments ?? values.replies,
    saves: values.saved, shares: values.shares, reposts: values.reposts, quotes: values.quotes,
  };
}

async function platformLive(userId: string, platform: MetaPlatform, username: string, period: string, planned: PlannedPost[], publications: PublicationRow[] | null): Promise<PlatformLive> {
  const empty = (state: PlatformLive['state']): PlatformLive => ({ platform, username, state, posts: [], matchedPostIds: [], publications: {} });
  const access = await usableToken(userId, platform);
  if ('error' in access) return empty(access.error === 'reconnect' ? 'reconnect' : 'unavailable');
  try {
    // Finish or give up on publications left processing (the app was closed mid-way).
    // publishDecision decides whether each one waits, publishes, is recovered or is released.
    for (const row of (publications ?? []).filter((item) => item.platform === platform && item.status === 'processing')) {
      await finishProcessing(userId, row, access).catch(() => undefined);
    }
    const listed = await callMeta(monthMedia(platform, access.accountId, access.token, monthRange(period)));
    const raw = (listed.data as Array<Record<string, unknown>>) ?? [];
    const posts: LivePost[] = await Promise.all(raw.map(async (item) => {
      const productType = (item.media_product_type as string | undefined) ?? null;
      let stats: LiveStats | null = null;
      try {
        stats = statsFrom(await callMeta(mediaInsights(platform, item.id as string, access.token, productType)));
      } catch {
        // One post's stats failing leaves the rest.
      }
      return {
        externalId: item.id as string, caption: ((item.caption ?? item.text) as string | undefined) ?? '', permalink: (item.permalink as string | undefined) ?? null,
        timestamp: item.timestamp as string, productType, thumbnail: (item.thumbnail_url as string | undefined) ?? null, stats,
      };
    }));
    // Without the publication records, matching could mark posts twice: skip it this time.
    const pairs = publications ? matchPosts(platform, planned, posts.filter((post) => !publications.some((row) => row.externalId === post.externalId))) : [];
    const matched: string[] = [];
    const linked: Record<string, string> = {};
    for (const row of publications ?? []) if (row.platform === platform && row.status === 'published' && row.externalId) linked[row.externalId] = row.postId;
    for (const pair of pairs) {
      // One post that can't be recorded must not hide the platform's stats.
      try {
        const at = new Date(pair.live.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
        if (Number.isNaN(at.getTime())) continue;
        await completePublication(userId, { id: null, postId: pair.postId, platform }, { externalId: pair.live.externalId, permalink: pair.live.permalink, publishedAt: at.toISOString(), source: 'matched' });
        matched.push(pair.postId);
        linked[pair.live.externalId] = pair.postId;
      } catch (error) {
        console.error('Auto-marking a post failed', error instanceof Error ? error.message : 'unknown');
      }
    }
    return { platform, username, state: 'ok', posts, matchedPostIds: matched, publications: linked };
  } catch (caught) {
    if (caught instanceof MetaError && caught.kind === 'auth') {
      await markReconnect(userId, platform);
      return empty('reconnect');
    }
    return empty('unavailable');
  }
}

/** Everything the Social tab shows from Instagram and Threads for one month. */
export async function loadLive(userId: string, period: string): Promise<SocialLive> {
  const connections = await listConnections(userId);
  if (!connections.length) return { platforms: [] };
  const month = await listMonth(userId, period);
  const publications = await listPublications(userId, month.posts.map((post) => post.id));
  const planned: PlannedPost[] = month.posts.map((post) => ({
    id: post.id, platforms: post.platforms, status: post.status, plannedFor: post.plannedFor, period: post.period, caption: post.caption,
    // Any record counts, dismissed included: "not published" must stick.
    publishedOn: (publications ?? []).filter((row) => row.postId === post.id).map((row) => row.platform),
  }));
  const platforms = await Promise.all(connections.map((connection) => (connection.status === 'reconnect_required'
    ? Promise.resolve<PlatformLive>({ platform: connection.platform, username: connection.username, state: 'reconnect', posts: [], matchedPostIds: [], publications: {} })
    : platformLive(userId, connection.platform, connection.username, period, planned, publications))));
  return { platforms };
}
