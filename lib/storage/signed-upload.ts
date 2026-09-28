import 'server-only';

import { randomUUID } from 'node:crypto';
import { UserFacingError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { contentTypeFor, isStagedPath, MAX_UPLOAD_BYTES, UPLOAD_BUCKET, uploadExtension, uploadProblem, type UploadKind } from '@/lib/storage/upload-rules';

// Large files go from the browser straight to Storage, because a request body
// over ~4.5 MB never reaches a Vercel function. The server picks the path, signs
// a one-time upload token with the admin client (the bucket has no user policy),
// and later reads the bytes back itself: it never trusts file content sent with
// an action.

const BUCKETS: Record<UploadKind, string> = { 'health-document': UPLOAD_BUCKET, workbook: UPLOAD_BUCKET };
const bucketFor = (kind: UploadKind) => BUCKETS[kind];

export async function createUploadTarget(userId: string, kind: UploadKind, file: { name: unknown; type: unknown; size: unknown }) {
  const problem = uploadProblem(file);
  if (problem) throw new UserFacingError(problem);
  const extension = uploadExtension(file.name)!;
  const { data, error } = await createAdminClient().storage.from(bucketFor(kind)).createSignedUploadUrl(`${userId}/${randomUUID()}.${extension}`);
  if (error || !data) {
    console.error('createSignedUploadUrl failed', error);
    throw new UserFacingError('The upload could not be started. Try again in a little while.');
  }
  return { path: data.path, token: data.token, contentType: contentTypeFor(extension) };
}

/**
 * The staged bytes as a File named after what the person chose, so the existing
 * parsers run unchanged. The extension always comes from the server-picked path.
 */
export async function downloadOwned(userId: string, kind: UploadKind, path: unknown, displayName?: unknown) {
  if (!isStagedPath(userId, path)) throw new UserFacingError('That upload could not be found. Choose the file again.');
  const { data, error } = await createAdminClient().storage.from(bucketFor(kind)).download(path);
  if (error || !data) throw new UserFacingError('The upload did not finish. Check your connection and try again.');
  if (data.size > MAX_UPLOAD_BYTES) throw new UserFacingError('This file is larger than 100 MB. Choose a smaller file and try again.');
  const extension = uploadExtension(path)!;
  const base = typeof displayName === 'string' ? displayName.slice(0, 200).replace(/\.[^.]*$/, '').replace(/[\\/]/g, '_').trim() : '';
  const bytes = Buffer.from(await data.arrayBuffer());
  return new File([bytes], `${base || 'document'}.${extension}`, { type: contentTypeFor(extension) });
}

const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Claims a staged path for processing, once ever. The table's primary key makes
 * this atomic, so concurrent calls on one path process it once, and a signed token
 * reused to re-upload to the same path finds it already claimed. Throws (fails
 * closed) when the claim can't be recorded.
 */
export async function claimStaged(userId: string, path: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from('staged_upload_claims').insert({ path, user_id: userId });
  if (error?.code === '23505') return false;
  if (error) {
    console.error('Claiming a staged upload failed', error);
    throw new UserFacingError('Uploads aren’t available right now. Try again in a little while.');
  }
  // Housekeeping: claims only need to outlive the ~2 hour signed-token window.
  const { error: pruneError } = await admin.from('staged_upload_claims').delete().eq('user_id', userId).lt('claimed_at', new Date(Date.now() - CLAIM_RETENTION_MS).toISOString());
  if (pruneError) console.error('Pruning staged upload claims failed', pruneError);
  return true;
}

export const ALREADY_CLAIMED_MESSAGE = 'This upload was already used. Choose the file again.';

/** Best-effort: a staged file is only a copy, so a failed delete is logged, not shown. */
export async function removeStaged(userId: string, kind: UploadKind, path: unknown) {
  if (!isStagedPath(userId, path)) return;
  try {
    const { error } = await createAdminClient().storage.from(bucketFor(kind)).remove([path]);
    if (error) console.error('Removing a staged upload failed', error);
  } catch (error) {
    console.error('Removing a staged upload failed', error);
  }
}
