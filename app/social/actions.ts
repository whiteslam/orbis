'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import {
  SocialError,
  copyMediaFile,
  createMediaUpload,
  deletePost,
  getPost,
  insertPost,
  listHistory,
  listMonth,
  mediaExists,
  removeMediaFiles,
  setStatus,
  updatePost,
} from '@/lib/social/repository';
import { PERIOD_PATTERN } from '@/lib/social/month';
import { cleanPostInput, cleanPublish } from '@/lib/social/validate';
import type { SocialPost, SocialRevision } from '@/lib/social/types';

async function authed() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return userId;
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

type Result = { success: boolean; message: string; post?: SocialPost; posts?: SocialPost[] };

const SIGN_IN = { success: false, message: 'Sign in again to do this.' } as const;
const INVALID = { success: false, message: 'That post is invalid.' } as const;

/** A SocialError is written for the user; anything else becomes the fallback. */
function failure(error: unknown, fallback: string): Result {
  return { success: false, message: error instanceof SocialError ? error.message : fallback };
}

export async function loadSocialMonthAction(period: string) {
  const userId = await authed();
  if (!userId) return { ...SIGN_IN, posts: [], databaseReady: true, loadError: true };
  if (typeof period !== 'string' || !PERIOD_PATTERN.test(period)) return { success: false, message: 'That month is invalid.', posts: [], databaseReady: true, loadError: true };
  const month = await listMonth(userId, period);
  return { success: !month.loadError, message: month.loadError ? 'This month could not be loaded. Try again.' : '', ...month };
}

/**
 * Saves a post. With `id` it edits; without, it creates, using `clientId` as
 * the new post's id so a second tap on Save returns the first post instead of
 * making a copy.
 */
export async function savePostAction(input: {
  id?: string;
  clientId?: string;
  period: string;
  title: string;
  headline?: string | null;
  caption: string;
  hashtags: string[];
  format: string;
  platforms: string[];
  plannedFor: string | null;
}): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (input?.id !== undefined && !validId(input.id)) return INVALID;
  if (input?.clientId !== undefined && !validId(input.clientId)) return INVALID;
  const clean = cleanPostInput(input);
  if (!clean.ok) return { success: false, message: clean.message };

  try {
    const post = input.id
      ? await updatePost(userId, input.id, clean.value)
      : await insertPost(userId, { ...clean.value, id: input.clientId }, 'created');
    revalidatePath('/');
    return { success: true, message: input.id ? 'Saved.' : 'Post added.', post };
  } catch (error) {
    return failure(error, 'That post could not be saved.');
  }
}

/** Idea, draft or ready. Published has its own action, and only it can undo itself. */
export async function setPostStatusAction(id: string, status: 'idea' | 'draft' | 'ready'): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  if (!['idea', 'draft', 'ready'].includes(status)) return { success: false, message: 'Choose idea, draft or ready.' };
  try {
    const current = await getPost(userId, id);
    if (!current) return { success: false, message: 'That post no longer exists.' };
    if (current.status === 'published') return { success: false, message: 'This post is published. Mark it as not published first.' };
    const post = await setStatus(userId, id, status);
    revalidatePath('/');
    return { success: true, message: status === 'ready' ? 'Ready to post.' : status === 'idea' ? 'Kept as an idea.' : 'Back to draft.', post };
  } catch (error) {
    return failure(error, 'That post could not be updated.');
  }
}

/** Records where and when a ready post went out, or (with null) takes that back. */
export async function markPublishedAction(id: string, publish: { platform: string; link?: string | null } | null): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  try {
    if (publish === null) {
      const current = await getPost(userId, id);
      if (!current) return { success: false, message: 'That post no longer exists.' };
      if (current.status !== 'published') return { success: true, message: 'Not published.', post: current };
      const post = await setStatus(userId, id, 'ready');
      revalidatePath('/');
      return { success: true, message: 'Marked as not published. It is ready again.', post };
    }
    const clean = cleanPublish(publish);
    if (!clean.ok) return { success: false, message: clean.message };
    const post = await setStatus(userId, id, 'published', clean.value);
    revalidatePath('/');
    return { success: true, message: 'Marked as published.', post };
  } catch (error) {
    return failure(error, 'That post could not be updated.');
  }
}

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const extensionOf = (path: string) => path.slice(path.lastIndexOf('.') + 1);
const mediaTypeOf = (extension: string): 'image' | 'video' => (['mp4', 'mov', 'webm'].includes(extension) ? 'video' : 'image');

export async function duplicatePostAction(id: string): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  try {
    const original = await getPost(userId, id);
    if (!original) return { success: false, message: 'That post no longer exists.' };
    const copyId = randomUUID();
    // The copy gets its own file, so deleting either post never breaks the other.
    const mediaPath = original.mediaPath
      ? await copyMediaFile(original.mediaPath, `${userId}/${copyId}/${randomUUID()}.${extensionOf(original.mediaPath)}`)
      : null;
    const post = await insertPost(userId, {
      id: copyId,
      period: original.period,
      title: `${original.title} (copy)`.slice(0, 120),
      headline: original.headline,
      caption: original.caption,
      hashtags: original.hashtags,
      format: original.format,
      platforms: original.platforms,
      plannedFor: original.plannedFor,
      status: 'draft',
      mediaPath,
      mediaType: mediaPath ? original.mediaType : null,
    });
    revalidatePath('/');
    return { success: true, message: original.mediaPath && !mediaPath ? 'Copied, without the picture or video.' : 'Copied as a draft.', post };
  } catch (error) {
    return failure(error, 'That post could not be copied.');
  }
}

/** Moves a post to another month. Its day cannot come along, so it lands in that month's "No date yet". */
export async function movePostAction(id: string, period: string): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  if (typeof period !== 'string' || !PERIOD_PATTERN.test(period)) return { success: false, message: 'That month is invalid.' };
  try {
    const current = await getPost(userId, id);
    if (!current) return { success: false, message: 'That post no longer exists.' };
    if (current.period === period) return { success: true, message: 'It is already in that month.', post: current };
    const post = await updatePost(userId, id, { period, plannedFor: null }, 'moved');
    revalidatePath('/');
    return { success: true, message: 'Moved. Pick a day for it in its new month.', post };
  } catch (error) {
    return failure(error, 'That post could not be moved.');
  }
}

export async function deletePostAction(id: string): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  try {
    await deletePost(userId, id);
    revalidatePath('/');
    return { success: true, message: 'Post deleted. Its history is kept.' };
  } catch (error) {
    return failure(error, 'That post could not be deleted.');
  }
}

/**
 * Starts an upload. The server picks the path, under the user's own folder and
 * this post's, so the browser can only ever upload where it is allowed to.
 */
export async function signMediaUploadAction(postId: string, file: { name: string; type: string; size: number }) {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(postId)) return INVALID;
  const extension = typeof file?.type === 'string' ? EXTENSION[file.type] : undefined;
  if (!extension) return { success: false, message: 'Use a JPG, PNG, WebP or GIF picture, or an MP4, MOV or WebM video.' };
  if (typeof file.size !== 'number' || file.size <= 0 || file.size > MAX_MEDIA_BYTES) return { success: false, message: 'Files can be up to 50 MB.' };
  try {
    const post = await getPost(userId, postId);
    if (!post) return { success: false, message: 'Save the post before adding a picture or video.' };
    if (post.status === 'published') return { success: false, message: 'This post is published. Mark it as not published to change it.' };
    const upload = await createMediaUpload(`${userId}/${postId}/${randomUUID()}.${extension}`);
    return { success: true, message: '', ...upload };
  } catch (error) {
    return failure(error, 'The upload could not be started.');
  }
}

/** Points the post at a file the browser just uploaded, after checking it is really this post's. */
export async function attachMediaAction(postId: string, path: string, type: 'image' | 'video'): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(postId) || typeof path !== 'string') return INVALID;
  const prefix = `${userId}/${postId}/`;
  const name = path.slice(prefix.length);
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm)$/i.test(name)) return { success: false, message: 'That file is not part of this post.' };
  const mediaType = mediaTypeOf(extensionOf(name).toLowerCase());
  if (type !== mediaType) return { success: false, message: 'That file is not part of this post.' };
  try {
    if (!(await mediaExists(path))) return { success: false, message: 'The upload did not finish. Try again.' };
    const before = await getPost(userId, postId);
    if (!before) return { success: false, message: 'That post no longer exists.' };
    const post = await updatePost(userId, postId, { mediaPath: path, mediaType });
    if (before.mediaPath && before.mediaPath !== path) await removeMediaFiles([before.mediaPath]);
    revalidatePath('/');
    return {
      success: true,
      message: before.status === 'ready' && post.status === 'draft' ? 'Added. The post is back to draft until you mark it ready again.' : 'Added.',
      post,
    };
  } catch (error) {
    await removeMediaFiles([path]);
    return failure(error, 'That file could not be added.');
  }
}

export async function removeMediaAction(postId: string): Promise<Result> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(postId)) return INVALID;
  try {
    const before = await getPost(userId, postId);
    if (!before) return { success: false, message: 'That post no longer exists.' };
    if (!before.mediaPath) return { success: true, message: 'Nothing to remove.', post: before };
    const post = await updatePost(userId, postId, { mediaPath: null, mediaType: null });
    await removeMediaFiles([before.mediaPath]);
    revalidatePath('/');
    return { success: true, message: 'Removed.', post };
  } catch (error) {
    return failure(error, 'That file could not be removed.');
  }
}

export async function loadPostHistoryAction(id: string): Promise<{ success: boolean; message: string; history?: SocialRevision[] }> {
  const userId = await authed();
  if (!userId) return SIGN_IN;
  if (!validId(id)) return INVALID;
  try {
    return { success: true, message: '', history: await listHistory(userId, id) };
  } catch (error) {
    return failure(error, 'History could not be loaded.');
  }
}
