/**
 * Social planner: the user's own posts, planned month by month.
 *
 * Client-safe. A port of WBT's Organic Social section with the reviewer taken
 * out: one person plans, marks a post ready, and records where it went out.
 */
export type SocialFormat = 'post' | 'reel' | 'story';
export type SocialStatus = 'idea' | 'draft' | 'ready' | 'published';
export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'youtube' | 'tiktok';

export type SocialPost = {
  id: string;
  /** 'YYYY-MM-01': the month the post belongs to, dated or not. */
  period: string;
  title: string;
  headline: string | null;
  caption: string;
  /** Stored without the leading '#'. */
  hashtags: string[];
  format: SocialFormat;
  platforms: SocialPlatform[];
  /** 'YYYY-MM-DD', always inside `period` when set. */
  plannedFor: string | null;
  status: SocialStatus;
  /** Private Storage path, never a public URL. */
  mediaPath: string | null;
  mediaType: 'image' | 'video' | null;
  /** Signed for an hour by the repository; never stored. */
  mediaUrl: string | null;
  published: { at: string; platform: string; link: string | null } | null;
  /** 'ai' until the user edits the title or caption. */
  source: 'manual' | 'ai';
  position: number;
  updatedAt: string;
};

export type SocialRevision = {
  id: string;
  action: string;
  previous: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  createdAt: string;
};

/** What a new post is made from; the repository fills in the rest. */
export type NewPost = {
  id?: string;
  period: string;
  title: string;
  headline: string | null;
  caption: string;
  hashtags: string[];
  format: SocialFormat;
  platforms: SocialPlatform[];
  plannedFor: string | null;
  status?: SocialStatus;
  source?: 'manual' | 'ai';
  mediaPath?: string | null;
  mediaType?: 'image' | 'video' | null;
};

/** The fields an edit may change. Status moves through setStatus, not here. */
export type PostPatch = Partial<Pick<SocialPost, 'period' | 'title' | 'headline' | 'caption' | 'hashtags' | 'format' | 'platforms' | 'plannedFor' | 'mediaPath' | 'mediaType' | 'position'>> & {
  /** Only used to move an idea to a draft and back; ready and published have their own checks. */
  status?: 'idea' | 'draft';
};

export const SOCIAL_FORMATS = [
  { id: 'post', label: 'Post', tint: '#cfe6e8' },
  { id: 'reel', label: 'Reel', tint: '#ffdfc6' },
  { id: 'story', label: 'Story', tint: '#dfe3f5' },
] as const satisfies ReadonlyArray<{ id: SocialFormat; label: string; tint: string }>;

export const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X' },
  { id: 'threads', label: 'Threads' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
] as const satisfies ReadonlyArray<{ id: SocialPlatform; label: string }>;

/** Where a post can be recorded as published: the planned platforms plus "somewhere else". */
export const PUBLISH_PLACES = [...SOCIAL_PLATFORMS, { id: 'other', label: 'Other' }] as const;

export const SOCIAL_STATUS_LABEL: Record<SocialStatus, string> = {
  idea: 'Idea', draft: 'Draft', ready: 'Ready', published: 'Published',
};

/** Caption limits the drawer warns about (not enforced by the database). */
export const CAPTION_LIMIT: Record<SocialPlatform, number> = {
  instagram: 2200, facebook: 63206, linkedin: 3000, x: 280, threads: 500, youtube: 5000, tiktok: 4000,
};

/** Hard caps, shared by the actions and the AI parser. The database checks the same numbers. */
export const SOCIAL_CAPS = { title: 120, headline: 200, caption: 5000, hashtags: 30, hashtag: 50 } as const;

export const formatLabel = (format: SocialFormat) => SOCIAL_FORMATS.find((item) => item.id === format)?.label ?? 'Post';
export const platformLabel = (platform: string) => PUBLISH_PLACES.find((item) => item.id === platform)?.label ?? platform;
