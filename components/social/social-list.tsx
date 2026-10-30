'use client';

import { Film, Image as ImageIcon, Sparkles } from 'lucide-react';
import { StatusChip } from '@/components/social/status-chip';
import { SOCIAL_STATUS_LABEL, formatLabel, platformLabel, type SocialPost, type SocialStatus } from '@/lib/social/types';

export function dayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The picture or video when there is one, otherwise the format's tint and icon. */
export function PostThumb({ post }: Readonly<{ post: SocialPost }>) {
  return (
    <span className={`so-thumb so-fmt-${post.format}`} aria-hidden="true">
      {post.mediaUrl && post.mediaType === 'image' && <img src={post.mediaUrl} alt="" loading="lazy" />}
      {post.mediaUrl && post.mediaType === 'video' && <video src={post.mediaUrl} muted playsInline preload="metadata" />}
      {!post.mediaUrl && (post.format === 'post' ? <ImageIcon size={16} /> : <Film size={16} />)}
    </span>
  );
}

function PostMeta({ post, withDate }: Readonly<{ post: SocialPost; withDate: boolean }>) {
  return (
    <>
      <span>{formatLabel(post.format)}</span>
      {withDate && <span>{post.plannedFor ? dayLabel(post.plannedFor) : 'No date'}</span>}
      {post.status === 'published' && post.published && <span>Went out on {platformLabel(post.published.platform)}</span>}
      {post.source === 'ai' && <span className="so-ai"><Sparkles size={10} aria-hidden="true" />AI draft</span>}
    </>
  );
}

export function PostRow({ post, onOpen, withDate = false }: Readonly<{ post: SocialPost; onOpen: (post: SocialPost) => void; withDate?: boolean }>) {
  return (
    <button type="button" className="so-row" onClick={() => onOpen(post)}>
      <PostThumb post={post} />
      <span className="so-row-text">
        <strong>{post.title}</strong>
        <small><PostMeta post={post} withDate={withDate} /></small>
      </span>
      <StatusChip status={post.status} />
    </button>
  );
}

const STATUS_ORDER: Record<SocialStatus, number> = { idea: 0, draft: 1, ready: 2, published: 3 };
export type SocialSort = 'date' | 'status' | 'format';

/** What each stage means, in plain words, under its name. */
const STAGE_HINT: Record<SocialStatus, string> = {
  idea: 'Worth making, not written yet',
  draft: 'Being written',
  ready: 'Done and waiting for its day',
  published: 'Out in the world',
};

/** Monday of the week a date falls in, as 'YYYY-MM-DD'. */
function mondayOf(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

type Group = { key: string; label: string; hint?: string; posts: SocialPost[] };

/** The rows split into the sort's natural groups: stages, weeks, or formats. */
function groupPosts(posts: SocialPost[], sort: SocialSort): Group[] {
  const groups = new Map<string, Group>();
  for (const post of posts) {
    let key: string;
    let label: string;
    let hint: string | undefined;
    if (sort === 'status') { key = post.status; label = SOCIAL_STATUS_LABEL[post.status]; hint = STAGE_HINT[post.status]; }
    else if (sort === 'format') { key = post.format; label = formatLabel(post.format); }
    else if (post.plannedFor) { key = mondayOf(post.plannedFor); label = `Week of ${dayLabel(key)}`; }
    else { key = 'none'; label = 'No date yet'; }
    const group = groups.get(key) ?? { key, label, hint, posts: [] };
    group.posts.push(post);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Rows in the chosen order, grouped under plain labels. Undated posts sort last by date. The order is picked in the section's header. */
export function SocialList({ posts, onOpen, sort = 'date' }: Readonly<{ posts: SocialPost[]; onOpen: (post: SocialPost) => void; sort?: SocialSort }>) {
  const byDate = (left: SocialPost, right: SocialPost) => (left.plannedFor ?? '9999').localeCompare(right.plannedFor ?? '9999');
  const sorted = [...posts].sort((left, right) => {
    if (sort === 'status') return STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || byDate(left, right);
    if (sort === 'format') return left.format.localeCompare(right.format) || byDate(left, right);
    return byDate(left, right);
  });
  return (
    <div className="so-rows" data-sort={sort}>
      {groupPosts(sorted, sort).map((group) => (
        <div className="so-rows-group" key={group.key}>
          <h3 className="so-group-label">{group.label} <span>{group.posts.length}</span>{group.hint && <small>{group.hint}</small>}</h3>
          {group.posts.map((post) => <PostRow key={post.id} post={post} onOpen={onOpen} withDate />)}
        </div>
      ))}
    </div>
  );
}

export function SocialGrid({ posts, onOpen }: Readonly<{ posts: SocialPost[]; onOpen: (post: SocialPost) => void }>) {
  return (
    <div className="so-grid">
      {posts.map((post) => (
        <button type="button" className="so-card" key={post.id} onClick={() => onOpen(post)}>
          <PostThumb post={post} />
          <span className="so-card-text">
            <strong>{post.title}</strong>
            <small><PostMeta post={post} withDate /><StatusChip status={post.status} /></small>
          </span>
        </button>
      ))}
    </div>
  );
}
