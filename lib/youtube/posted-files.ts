import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

// Once YouTube has a short, its files leave storage so the space can be used
// again. Every detail stays: the queue row (title, description, when it posted,
// the YouTube id) and the short itself (topic, plan, title and caption).
// The posted list shows YouTube's own thumbnail instead of the removed cover.

type Admin = ReturnType<typeof createAdminClient>;

const BUCKET = 'shorts';

type PostedRow = { jobId: string | null; videoPath: string; coverPath: string | null };
type DeliveryLike = { files?: Record<string, unknown> | null } | null;

/** Only a path inside the person's own folder is ever removed. */
const ownPath = (userId: string, path: unknown): path is string =>
  typeof path === 'string' && path.startsWith(`${userId}/`) && !path.includes('..');

/** Every stored file of a posted short: the queued video and cover, and each file the build made. Each once. */
export function postedFilePaths(userId: string, row: Pick<PostedRow, 'videoPath' | 'coverPath'>, delivery: DeliveryLike): string[] {
  const files = delivery?.files ?? {};
  const all = [row.videoPath, row.coverPath, files.video, files.share, files.cover, files.sheet];
  return [...new Set(all.filter((path): path is string => ownPath(userId, path)))];
}

/**
 * Removes a posted short's files from storage. Never throws: the video is on
 * YouTube whatever happens here. Returns whether storage took the removal.
 */
export async function removePostedFiles(admin: Admin, userId: string, row: PostedRow): Promise<boolean> {
  try {
    let delivery: DeliveryLike = null;
    if (row.jobId) {
      const { data } = await admin.from('shorts_jobs').select('delivery').eq('user_id', userId).eq('id', row.jobId).maybeSingle();
      delivery = (data?.delivery ?? null) as DeliveryLike;
    }
    const paths = postedFilePaths(userId, row, delivery);
    if (!paths.length) return true;
    const { error } = await admin.storage.from(BUCKET).remove(paths);
    if (error) {
      console.error('Could not remove a posted short’s files:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Could not remove a posted short’s files', error);
    return false;
  }
}

/** YouTube's own thumbnail for a video, or null for an id that isn't one. */
export function youtubeThumbnail(youtubeId: string | null | undefined): string | null {
  return youtubeId && /^[\w-]{1,64}$/.test(youtubeId) ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null;
}
