'use client';

import { attachMediaAction, signMediaUploadAction } from '@/app/social/actions';
import { safeAction } from '@/lib/client/safe-action';
import { createClient } from '@/lib/supabase/client';
import { SOCIAL_BUCKET_NAME } from '@/lib/social/types';
import type { SocialPost } from '@/lib/social/types';

export type UploadResult = { success: true; post: SocialPost; message: string } | { success: false; message: string };

/**
 * Puts a picture or video on a saved post: the server picks the path, the
 * browser uploads straight to Storage, then the server checks and attaches it.
 * Shared by the post drawer and the Studio composer.
 */
export async function uploadPostMedia(postId: string, file: File): Promise<UploadResult> {
  const signed = await safeAction(signMediaUploadAction)(postId, { name: file.name, type: file.type, size: file.size });
  if (!signed.success || !signed.path || !signed.token) return { success: false, message: signed.message };
  const { error } = await createClient().storage.from(SOCIAL_BUCKET_NAME).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { success: false, message: 'The upload did not finish. Check your connection and try again.' };
  const result = await safeAction(attachMediaAction)(postId, signed.path, file.type.startsWith('video/') ? 'video' : 'image');
  if (result.success && result.post) return { success: true, post: result.post, message: result.message };
  return { success: false, message: result.message };
}
