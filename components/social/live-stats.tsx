'use client';

import { META_LABEL, type LiveStats, type SocialLive } from '@/lib/meta/types';
import type { SocialPost } from '@/lib/social/types';

const compact = (value: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function formatStats(stats: LiveStats) {
  const parts: string[] = [];
  if (stats.reach !== undefined) parts.push(`${compact(stats.reach)} reach`);
  else if (stats.views !== undefined) parts.push(`${compact(stats.views)} views`);
  if (stats.likes !== undefined) parts.push(`${compact(stats.likes)} likes`);
  if (stats.comments !== undefined) parts.push(`${compact(stats.comments)} comments`);
  if (stats.saves !== undefined) parts.push(`${compact(stats.saves)} saves`);
  if (stats.reposts !== undefined) parts.push(`${compact(stats.reposts)} reposts`);
  return parts.join(' · ');
}

/** One line per connected platform, and what went out that wasn't in the plan. */
export function MonthLive({ live }: { live: SocialLive | null }) {
  if (!live?.platforms.length) return null;
  return (
    <section className="so-live" aria-label="Instagram and Threads this month">
      {live.platforms.map((platform) => {
        const name = META_LABEL[platform.platform];
        if (platform.state === 'reconnect') return <p key={platform.platform} className="so-live-line">Reconnect {name} in Settings to see stats.</p>;
        if (platform.state === 'unavailable') return <p key={platform.platform} className="so-live-line">{name} stats unavailable right now.</p>;
        const reach = platform.posts.reduce((sum, post) => sum + (post.stats?.reach ?? post.stats?.views ?? 0), 0);
        const outside = platform.posts.filter((post) => !platform.publications[post.externalId]);
        return (
          <div key={platform.platform}>
            <p className="so-live-line"><strong>{name}</strong> · {platform.posts.length} {platform.posts.length === 1 ? 'post' : 'posts'} · {compact(reach)} {platform.platform === 'instagram' ? 'reach' : 'views'}</p>
            {outside.length > 0 && (
              <details className="so-outside">
                <summary>Posted outside your plan ({outside.length})</summary>
                <ul>{outside.map((post) => <li key={post.externalId}>{post.permalink ? <a href={post.permalink} target="_blank" rel="noopener noreferrer">{post.caption.slice(0, 60) || 'Untitled'}</a> : post.caption.slice(0, 60)}{post.stats ? ` · ${formatStats(post.stats)}` : ''}</li>)}</ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The small stats line under a published post, one platform after another. */
export function PostStatsLine({ post, live }: { post: SocialPost; live: SocialLive | null }) {
  if (!live || post.status !== 'published') return null;
  const lines = live.platforms.flatMap((platform) => {
    const externalId = Object.entries(platform.publications).find(([, postId]) => postId === post.id)?.[0];
    const stats = externalId ? platform.posts.find((item) => item.externalId === externalId)?.stats : null;
    return stats ? [`${META_LABEL[platform.platform]}: ${formatStats(stats)}`] : [];
  });
  return lines.length ? <small className="so-stats">{lines.join(' — ')}</small> : null;
}
