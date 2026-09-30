// Instagram and Threads, as the Social planner sees them. Client-safe.

export type MetaPlatform = 'instagram' | 'threads';
export const META_PLATFORMS: MetaPlatform[] = ['instagram', 'threads'];
export const META_LABEL: Record<MetaPlatform, string> = { instagram: 'Instagram', threads: 'Threads' };

/** What one container is made of. `kind` decides the media_type sent. */
export type ContainerSpec =
  | { kind: 'image'; mediaUrl: string; text: string }
  | { kind: 'video'; mediaUrl: string; text: string }
  | { kind: 'story_image'; mediaUrl: string; text: string }
  | { kind: 'story_video'; mediaUrl: string; text: string }
  | { kind: 'text'; text: string };

/** Normalised stats. A number is absent when that platform or media type has no such metric. */
export type LiveStats = { views?: number; reach?: number; likes?: number; comments?: number; saves?: number; shares?: number; reposts?: number; quotes?: number };

export type LivePost = {
  externalId: string;
  caption: string;
  permalink: string | null;
  timestamp: string;
  productType: string | null;
  thumbnail: string | null;
  stats: LiveStats | null;
};

export type PlatformLive = {
  platform: MetaPlatform;
  username: string;
  state: 'ok' | 'reconnect' | 'unavailable';
  posts: LivePost[];
  /** Planned posts newly marked published by this call. */
  matchedPostIds: string[];
  /** External id → Orbis post id, for every publication on this platform this month. */
  publications: Record<string, string>;
};

export type SocialLive = { platforms: PlatformLive[] };

export type ConnectionSummary = {
  platform: MetaPlatform;
  username: string;
  status: 'connected' | 'reconnect_required';
};

export type PublishResult =
  | { success: true; message: string; state: 'published'; permalink: string | null }
  | { success: true; message: string; state: 'processing'; publicationId: string }
  | { success: false; message: string };
