import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { SHORTS_BUCKET, SIGNED_URL_SECONDS } from '@/lib/shorts/repository';

// Signing a queued video for the publisher. Unlike signPaths (which drops any
// path it can't sign), this tells a video storage says isn't there apart from a
// signing that failed for another reason: the first can never be posted, the
// second may pass and is worth another attempt.

type Admin = ReturnType<typeof createAdminClient>;

export type SignedVideo = { url: string } | { missing: true } | { failed: string };

/** Storage's answer for a path with no object ("Either the object does not exist or ..."), or a plain not found. */
const NOT_THERE = /does not exist|not[_ ]?found/i;

export async function signVideo(admin: Admin, path: string): Promise<SignedVideo> {
  try {
    const { data, error } = await admin.storage.from(SHORTS_BUCKET).createSignedUrls([path], SIGNED_URL_SECONDS);
    if (error) return { failed: error.message || 'storage refused to sign' };
    const item = (data ?? []).find((one) => one.path === path) ?? (data ?? [])[0];
    if (item?.signedUrl) return { url: item.signedUrl };
    if (item?.error && NOT_THERE.test(item.error)) return { missing: true };
    return { failed: item?.error || 'storage gave no address' };
  } catch (error) {
    console.error('Signing a YouTube video failed', error);
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}
