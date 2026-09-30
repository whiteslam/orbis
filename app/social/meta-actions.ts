'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isMetaPlatform } from '@/lib/meta/config';
import { deleteConnection } from '@/lib/meta/connection';
import { META_LABEL } from '@/lib/meta/types';

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
