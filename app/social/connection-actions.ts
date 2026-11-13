'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { deleteSocialConnection } from '@/lib/social/connections';
import type { SocialPlatformId } from '@/lib/social/meta';
import { disconnectYouTube } from '@/lib/youtube/connection';

const isPlatform = (value: unknown): value is SocialPlatformId | 'youtube' => value === 'instagram' || value === 'threads' || value === 'youtube';

const disconnected = {
  instagram: 'Instagram disconnected. Posts you already published stay as they are.',
  threads: 'Threads disconnected. Posts you already published stay as they are.',
  youtube: 'YouTube disconnected. Videos already on your channel stay there. Queued shorts wait until you connect again.',
} as const;

export async function disconnectSocialAction(platform: string) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again to disconnect this.' };
  if (!isPlatform(platform)) return { success: false, message: 'That account is not connected.' };
  try {
    if (platform === 'youtube') await disconnectYouTube(userId);
    else await deleteSocialConnection(userId, platform);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That could not be disconnected.' };
  }
  revalidatePath('/active');
  return { success: true, message: disconnected[platform] };
}
