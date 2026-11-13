'use client';

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { StatusChip } from '@/components/social/status-chip';
import { dayLabel } from '@/components/social/social-list';
import { usePersonLocale } from '@/components/locale/person-locale';
import { SOCIAL_FORMATS, formatLabel, type SocialPost } from '@/lib/social/types';

const tintOf = (post: SocialPost) => SOCIAL_FORMATS.find((format) => format.id === post.format)?.tint ?? SOCIAL_FORMATS[0].tint;

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
    <article className="st-card">
      <button type="button" className="st-card-open" onClick={() => onOpen(post)} aria-label={`Open “${post.title}”`}>
        <span className="st-card-head">
          <span className="st-card-avatar" aria-hidden="true" />
          <span className="st-card-who">{accountName}</span>
          <span className="st-card-day">{post.plannedFor ? dayLabel(post.plannedFor, locale) : 'No date'}</span>
        </span>
        <span className="st-card-media">
          {post.mediaUrl && post.mediaType === 'image' && <img src={post.mediaUrl} alt="" loading="lazy" />}
          {post.mediaUrl && post.mediaType === 'video' && <video src={post.mediaUrl} muted playsInline preload="metadata" />}
          {!post.mediaUrl && <span className="st-card-tint" style={{ background: tintOf(post) }}>{post.headline || post.title}</span>}
        </span>
        <span className="st-card-caption">
          <b>{accountName}</b> {post.caption || post.title}
        </span>
        <span className="st-card-chips">
          <span className="st-chip">{formatLabel(post.format)}</span>
          <StatusChip status={post.status} />
          {post.source === 'ai' && <span className="st-chip st-chip-ai"><Sparkles size={11} aria-hidden="true" />AI</span>}
        </span>
      </button>
      {actions && <div className="st-card-actions">{actions}</div>}
    </article>
  );
}
