import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingBucketError } from '@/lib/account/deletion-plan';

type Storage = SupabaseClient['storage'];

const PAGE = 100;
// Paths are `${userId}/<id>/<file>` at most; anything deeper is not ours to walk.
const MAX_DEPTH = 6;
// A pass lists and removes everything it found. More than one is only needed
// if a file arrives while the account is being deleted.
const MAX_PASSES = 3;

/** True when the bucket exists; a missing bucket (a feature not set up yet) is skipped. */
async function bucketExists(storage: Storage, bucket: string) {
  const { error } = await storage.getBucket(bucket);
  if (!error) return true;
  if (isMissingBucketError(error)) return false;
  throw new Error(`Storage bucket ${bucket} could not be read: ${error.message}`);
}

/** Every object path under `prefix`, walking folders and paging each listing until it runs out. */
async function walk(storage: Storage, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const entries: Array<{ id: string | null; name: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }); // NOSONAR: pages are read in turn until one comes back short
    if (error) throw new Error(`Storage listing failed in ${bucket}: ${error.message}`);
    entries.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const found = await Promise.all(
    entries.map((entry) => {
      const path = `${prefix}/${entry.name}`;
      // Folders come back with no id.
      return entry.id === null ? walk(storage, bucket, path, depth + 1) : [path];
    }),
  );
  return found.flat();
}

/** The paths of every file this person has in each bucket that exists. */
export async function listUserObjects(storage: Storage, buckets: readonly string[], userId: string) {
  const found = await Promise.all(
    buckets.map(async (bucket) => ((await bucketExists(storage, bucket)) ? { bucket, paths: await walk(storage, bucket, userId) } : null)),
  );
  return found.filter((entry): entry is { bucket: string; paths: string[] } => entry !== null);
}

/** Removes `paths` from `bucket`, a page at a time. */
async function removePaths(storage: Storage, bucket: string, paths: string[]) {
  const pages: string[][] = [];
  for (let start = 0; start < paths.length; start += PAGE) pages.push(paths.slice(start, start + PAGE));
  await Promise.all(
    pages.map(async (page) => {
      const { error } = await storage.from(bucket).remove(page);
      if (error) throw new Error(`Storage removal failed in ${bucket}: ${error.message}`);
    }),
  );
}

/** Removes every file under `${userId}/` in one bucket. Throws if any is left. */
async function clearBucket(storage: Storage, bucket: string, userId: string) {
  let remaining: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    remaining = await walk(storage, bucket, userId); // NOSONAR: each pass re-lists what the previous pass left behind
    if (remaining.length === 0) break;
    await removePaths(storage, bucket, remaining); // NOSONAR: a pass must finish removing before the next one lists again
  }
  if (remaining.length > 0 && (await walk(storage, bucket, userId)).length > 0) {
    throw new Error(`Storage in ${bucket} still holds files for this account.`);
  }
}

/** Removes every file under `${userId}/` in each bucket that exists. Throws if any is left. */
export async function removeUserObjects(storage: Storage, buckets: readonly string[], userId: string) {
  await Promise.all(
    buckets.map(async (bucket) => {
      if (await bucketExists(storage, bucket)) await clearBucket(storage, bucket, userId);
    }),
  );
}
