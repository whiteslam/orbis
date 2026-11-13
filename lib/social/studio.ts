// The Social Studio's pure rules: who may use which account, how a post is
// titled from its caption, and how a month's posts are grouped on the page.
// Relative imports, so the unit tests can load this module under plain Node.
import type { Role } from '../security/role.ts';
import type { SocialAccount, SocialPost } from './types.ts';

/** Orbis's own promotion page belongs to the owner alone. */
export function accountAllowed(account: SocialAccount, role: Role): boolean {
  return account === 'me' || role === 'owner';
}

const TITLE_MAX = 120;

/** A composer post's title: the caption's first line, or what it shows when there are no words. */
export function titleFromCaption(caption: string, mediaType: 'image' | 'video' | null): string {
  const line = caption.split('\n').map((part) => part.trim()).find(Boolean);
  if (line) return line.slice(0, TITLE_MAX);
  if (mediaType === 'image') return 'Photo post';
  if (mediaType === 'video') return 'Video post';
  return 'Untitled post';
}

export type PostGroups = { comingUp: SocialPost[]; noDate: SocialPost[]; pastNotPosted: SocialPost[]; posted: SocialPost[] };

const byDay = (left: SocialPost, right: SocialPost) => (left.plannedFor ?? '').localeCompare(right.plannedFor ?? '') || left.position - right.position;

/**
 * The month on the page: what's coming up (from today), undated posts, dated
 * ones whose day passed without going out, and what went out (newest first).
 */
export function groupPosts(posts: SocialPost[], today: string): PostGroups {
  const groups: PostGroups = { comingUp: [], noDate: [], pastNotPosted: [], posted: [] };
  for (const post of posts) {
    if (post.status === 'published') groups.posted.push(post);
    else if (!post.plannedFor) groups.noDate.push(post);
    else if (post.plannedFor >= today) groups.comingUp.push(post);
    else groups.pastNotPosted.push(post);
  }
  groups.comingUp.sort(byDay);
  groups.pastNotPosted.sort(byDay);
  groups.noDate.sort((left, right) => left.position - right.position);
  groups.posted.sort((left, right) => (right.published?.at ?? '').localeCompare(left.published?.at ?? ''));
  return groups;
}

export const postsFor = (posts: SocialPost[], account: SocialAccount) => posts.filter((post) => post.account === account);
