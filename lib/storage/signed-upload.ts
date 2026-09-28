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
