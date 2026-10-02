'use client';

import { Film, Image as ImageIcon, Sparkles } from 'lucide-react';
import { StatusChip } from '@/components/social/status-chip';
import { formatLabel, type SocialPost, type SocialStatus } from '@/lib/social/types';

export function dayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The picture or video when there is one, otherwise the format's tint and icon. */
export function PostThumb({ post }: { post: SocialPost }) {
  return (
    <span className={`so-thumb so-fmt-${post.format}`} aria-hidden="true">
      {post.mediaUrl && post.mediaType === 'image' && <img src={post.mediaUrl} alt="" loading="lazy" />}
      {post.mediaUrl && post.mediaType === 'video' && <video src={post.mediaUrl} muted playsInline preload="metadata" />}
      {!post.mediaUrl && (post.format === 'post' ? <ImageIcon size={16} /> : <Film size={16} />)}
    </span>
  );
}

function PostMeta({ post, withDate }: { post: SocialPost; withDate: boolean }) {
  return (
    <>
      <span>{formatLabel(post.format)}</span>
      {withDate && <span>{post.plannedFor ? dayLabel(post.plannedFor) : 'No date'}</span>}
      <StatusChip status={post.status} />
      {post.source === 'ai' && <span className="so-ai"><Sparkles size={9} aria-hidden="true" />AI draft</span>}
    </>
  );
}

export function PostRow({ post, onOpen, withDate = false }: { post: SocialPost; onOpen: (post: SocialPost) => void; withDate?: boolean }) {
  return (
    <button type="button" className="so-row" onClick={() => onOpen(post)}>
      <PostThumb post={post} />
      <span className="so-row-text">
        <strong>{post.title}</strong>
        <small><PostMeta post={post} withDate={withDate} /></small>
      </span>
    </button>
  );
}

const STATUS_ORDER: Record<SocialStatus, number> = { idea: 0, draft: 1, ready: 2, published: 3 };
export type SocialSort = 'date' | 'status' | 'format';

/** Rows in the chosen order. Undated posts sort last by date. The order is picked in the card's header. */
export function SocialList({ posts, onOpen, sort = 'date' }: { posts: SocialPost[]; onOpen: (post: SocialPost) => void; sort?: SocialSort }) {
  const byDate = (left: SocialPost, right: SocialPost) => (left.plannedFor ?? '9999').localeCompare(right.plannedFor ?? '9999');
  const sorted = [...posts].sort((left, right) => {
    if (sort === 'status') return STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || byDate(left, right);
    if (sort === 'format') return left.format.localeCompare(right.format) || byDate(left, right);
    return byDate(left, right);
  });
  return <div className="so-rows">{sorted.map((post) => <PostRow key={post.id} post={post} onOpen={onOpen} withDate />)}</div>;
}

export function SocialGrid({ posts, onOpen }: { posts: SocialPost[]; onOpen: (post: SocialPost) => void }) {
  return (
    <div className="so-grid">
      {posts.map((post) => (
        <button type="button" className="so-card" key={post.id} onClick={() => onOpen(post)}>
          <PostThumb post={post} />
          <span className="so-card-text">
            <strong>{post.title}</strong>
            <small><PostMeta post={post} withDate /></small>
          </span>
        </button>
      ))}
    </div>
  );
}
