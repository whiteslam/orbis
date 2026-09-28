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
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Storage listing failed in ${bucket}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      // Folders come back with no id.
      if (entry.id === null) paths.push(...(await walk(storage, bucket, path, depth + 1)));
      else paths.push(path);
    }
    if (!data || data.length < PAGE) return paths;
  }
}

/** The paths of every file this person has in each bucket that exists. */
export async function listUserObjects(storage: Storage, buckets: readonly string[], userId: string) {
  const found: Array<{ bucket: string; paths: string[] }> = [];
  for (const bucket of buckets) {
    if (!(await bucketExists(storage, bucket))) continue;
    found.push({ bucket, paths: await walk(storage, bucket, userId) });
  }
  return found;
}

/** Removes every file under `${userId}/` in each bucket that exists. Throws if any is left. */
export async function removeUserObjects(storage: Storage, buckets: readonly string[], userId: string) {
  for (const bucket of buckets) {
    if (!(await bucketExists(storage, bucket))) continue;
    let remaining: string[] = [];
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      remaining = await walk(storage, bucket, userId);
      if (remaining.length === 0) break;
      for (let start = 0; start < remaining.length; start += PAGE) {
        const { error } = await storage.from(bucket).remove(remaining.slice(start, start + PAGE));
        if (error) throw new Error(`Storage removal failed in ${bucket}: ${error.message}`);
      }
    }
    if (remaining.length > 0 && (await walk(storage, bucket, userId)).length > 0) {
      throw new Error(`Storage in ${bucket} still holds files for this account.`);
    }
  }
}
