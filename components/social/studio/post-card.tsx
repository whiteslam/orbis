'use client';

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { StatusChip } from '@/components/social/status-chip';
import { dayLabel } from '@/components/social/social-list';
import { usePersonLocale } from '@/components/locale/person-locale';
import { formatLabel, type SocialPost } from '@/lib/social/types';

/**
 * A post as it will look on Instagram: who it's from, the square picture (or
 * its headline on the format's tint when there is none), two lines of caption,
 * then its format and stage. The card opens the post; `actions` sit below it.
 */
export function PostCard({ post, accountName, onOpen, actions }: Readonly<{
  post: SocialPost;
  accountName: string;
  onOpen: (post: SocialPost) => void;
  actions?: ReactNode;
}>) {
  const { locale } = usePersonLocale();
  return (
    <article className="studio-card">
      <button type="button" className="studio-card-open" onClick={() => onOpen(post)} aria-label={`Open “${post.title}”`}>
        <span className="studio-card-head">
          <span className="studio-card-avatar" aria-hidden="true" />
          <span className="studio-card-who">{accountName}</span>
          <span className="studio-card-day">{post.plannedFor ? dayLabel(post.plannedFor, locale) : 'No date'}</span>
        </span>
        <span className="studio-card-media">
          {post.mediaUrl && post.mediaType === 'image' && <img src={post.mediaUrl} alt="" loading="lazy" />}
          {post.mediaUrl && post.mediaType === 'video' && <video src={post.mediaUrl} muted playsInline preload="metadata" />}
          {!post.mediaUrl && <span className={`studio-card-tint is-${post.format}`}>{post.headline || post.title}</span>}
        </span>
        <span className="studio-card-caption">
          <b>{accountName}</b> {post.caption || post.title}
        </span>
        <span className="studio-card-chips">
          <span className="studio-chip">{formatLabel(post.format)}</span>
          <StatusChip status={post.status} />
          {post.source === 'ai' && <span className="studio-chip studio-chip-ai"><Sparkles size={11} aria-hidden="true" />AI</span>}
        </span>
      </button>
      {actions && <div className="studio-card-actions">{actions}</div>}
    </article>
  );
}
