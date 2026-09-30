'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { deleteSocialConnection } from '@/lib/social/connections';
import type { SocialPlatformId } from '@/lib/social/meta';

const isPlatform = (value: unknown): value is SocialPlatformId => value === 'instagram' || value === 'threads';

export async function disconnectSocialAction(platform: string) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again to disconnect this.' };
  if (!isPlatform(platform)) return { success: false, message: 'That account is not connected.' };
  try {
    await deleteSocialConnection(userId, platform);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That could not be disconnected.' };
  }
  revalidatePath('/active');
  const name = platform === 'instagram' ? 'Instagram' : 'Threads';
  return { success: true, message: `${name} disconnected. Posts you already published stay as they are.` };
}
