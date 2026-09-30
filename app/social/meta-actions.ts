'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isMetaPlatform } from '@/lib/meta/config';
import { deleteConnection } from '@/lib/meta/connection';
import { META_LABEL } from '@/lib/meta/types';
import { isUuid } from '@/lib/validate/id';
import { checkPublish, startPublish } from '@/lib/meta/publish';
import type { PublishResult } from '@/lib/meta/types';

type Result = { success: boolean; message: string };
const SIGN_IN: Result = { success: false, message: 'Sign in again to do this.' };

/** Forgets the token. Meta's own permission is removed in the Instagram or Threads app. */
export async function disconnectMetaAction(platform: unknown): Promise<Result> {
  const userId = (await requireUser())?.userId;
  if (!userId) return SIGN_IN;
  if (!isMetaPlatform(platform)) return { success: false, message: 'That connection is not known.' };
  try {
    await deleteConnection(userId, platform);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Disconnect failed');
    return { success: false, message: `${META_LABEL[platform]} could not be disconnected. Try again.` };
  }
  revalidatePath('/');
  return { success: true, message: `${META_LABEL[platform]} disconnected. To remove Orbis entirely, also remove it in ${META_LABEL[platform]}’s settings under Website permissions.` };
}

/** Publishes a saved, ready post to one platform. Called only from the confirm sheet. */
export async function startPublishAction(postId: unknown, platform: unknown): Promise<PublishResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return { success: false, message: SIGN_IN.message };
  if (!isUuid(postId) || !isMetaPlatform(platform)) return { success: false, message: 'That post is invalid.' };
  const result = await startPublish(userId, postId, platform);
  if (result.success) revalidatePath('/');
  return result;
}

/** Checks a video still being processed by Meta, and publishes it once it is ready. */
export async function checkPublishAction(publicationId: unknown): Promise<PublishResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return { success: false, message: SIGN_IN.message };
  if (!isUuid(publicationId)) return { success: false, message: 'That is not a publication.' };
  const result = await checkPublish(userId, publicationId);
  if (result.success && result.state === 'published') revalidatePath('/');
  return result;
}
