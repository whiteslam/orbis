import { postedLength } from '@/lib/social/month';
import type { SocialPost } from '@/lib/social/types';
import { META_LABEL, type ContainerSpec, type MetaPlatform } from '@/lib/meta/types';

export type PublishablePost = Pick<SocialPost, 'status' | 'platforms' | 'format' | 'caption' | 'hashtags' | 'mediaPath' | 'mediaType'>;
export type PublishContext = { connection: 'connected' | 'reconnect_required' | null; publication: 'processing' | 'published' | null; dirty: boolean };

const TEXT_LIMIT: Record<MetaPlatform, number> = { instagram: 2200, threads: 500 };
const IG_HASHTAGS = 30;
const IMAGES: Record<MetaPlatform, string[]> = { instagram: ['jpg', 'jpeg'], threads: ['jpg', 'jpeg', 'png'] };
const VIDEOS = ['mp4', 'mov'];

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** The words exactly as they will be posted, and as the confirm sheet shows them. */
export function postedText(caption: string, hashtags: string[]) {
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  return tags ? `${caption}\n\n${tags}` : caption;
}

/** Why this post cannot go to this platform now, or null. Checked in the drawer and again on the server. */
export function publishProblem(post: PublishablePost, platform: MetaPlatform, context: PublishContext): string | null {
  const name = META_LABEL[platform];
  if (!context.connection) return `Connect ${name} in Settings first.`;
  if (context.connection === 'reconnect_required') return `Reconnect ${name} in Settings.`;
  if (context.dirty || (post.status !== 'ready' && post.status !== 'published')) return 'Save the post and mark it ready first.';
  if (!post.platforms.includes(platform)) return `Add ${name} to this post’s platforms first.`;
  if (context.publication === 'published') return `Already published on ${name}.`;
  if (context.publication === 'processing') return `Publishing on ${name} is in progress.`;

  if (post.format === 'story' && platform === 'threads') return 'Threads has no Stories.';
  if (!post.mediaPath) {
    if (platform === 'instagram') return 'Instagram needs a photo or video.';
  } else if (post.mediaType === 'video') {
    const kind = extension(post.mediaPath);
    if (!VIDEOS.includes(kind)) return `${name} doesn’t accept .${kind} video. Use MP4 or MOV.`;
  } else {
    const kind = extension(post.mediaPath);
    if (!IMAGES[platform].includes(kind)) {
      return platform === 'instagram' ? 'Instagram only accepts JPEG photos. Re-export it as .jpg.' : `Threads doesn’t accept .${kind} files. Use a JPEG or PNG.`;
    }
  }

  const length = postedLength(post.caption, post.hashtags);
  if (length > TEXT_LIMIT[platform]) return `The text is ${length.toLocaleString('en-IN')} characters; ${name} allows ${TEXT_LIMIT[platform].toLocaleString('en-IN')}.`;
  if (platform === 'instagram' && post.hashtags.length > IG_HASHTAGS) return `Instagram allows ${IG_HASHTAGS} hashtags; this post has ${post.hashtags.length}.`;
  return null;
}

/** What to ask Meta to make. Call only after publishProblem returned null. */
export function containerSpec(post: PublishablePost, platform: MetaPlatform, mediaUrl: string | null): ContainerSpec {
  const text = postedText(post.caption, post.hashtags);
  if (!post.mediaPath || !mediaUrl) return { kind: 'text', text };
  const video = post.mediaType === 'video';
  if (post.format === 'story' && platform === 'instagram') return video ? { kind: 'story_video', mediaUrl, text } : { kind: 'story_image', mediaUrl, text };
  return video ? { kind: 'video', mediaUrl, text } : { kind: 'image', mediaUrl, text };
}
