import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { editUnreadies, readyProblem } from '@/lib/social/month';
import type { NewPost, PostPatch, SocialFormat, SocialPlatform, SocialPost, SocialRevision, SocialStatus } from '@/lib/social/types';

export const SOCIAL_BUCKET = 'social-media';
const COLUMNS = 'id,period,title,headline,caption,hashtags,format,platforms,planned_for,status,media_path,media_type,published_at,published_platform,published_link,source,position,updated_at';
const SIGNED_URL_SECONDS = 60 * 60;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type HistoryAction = 'created' | 'edited' | 'ai_draft' | 'ready' | 'unready' | 'published' | 'unpublished' | 'moved' | 'deleted';

export const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');
const SETUP_MESSAGE = 'Apply the social planner migration in Supabase, then try again.';

/** An error whose message is safe to show as-is. */
export class SocialError extends Error {}

function toPost(row: Record<string, unknown>): SocialPost {
  return {
    id: String(row.id),
    period: String(row.period),
    title: String(row.title),
    headline: typeof row.headline === 'string' ? row.headline : null,
    caption: typeof row.caption === 'string' ? row.caption : '',
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
    format: row.format as SocialFormat,
    platforms: Array.isArray(row.platforms) ? (row.platforms as SocialPlatform[]) : [],
    plannedFor: typeof row.planned_for === 'string' ? row.planned_for : null,
    status: row.status as SocialStatus,
    mediaPath: typeof row.media_path === 'string' ? row.media_path : null,
    mediaType: row.media_type === 'image' || row.media_type === 'video' ? row.media_type : null,
    mediaUrl: null,
    published: typeof row.published_at === 'string'
      ? { at: row.published_at, platform: String(row.published_platform ?? 'other'), link: typeof row.published_link === 'string' ? row.published_link : null }
      : null,
    source: row.source === 'ai' ? 'ai' : 'manual',
    position: Number(row.position) || 0,
    updatedAt: String(row.updated_at),
  };
}

/** What a history row remembers about a post: the words and the plan, not the signed URL. */
function snapshotOf(post: SocialPost) {
  return {
    title: post.title,
    headline: post.headline,
    caption: post.caption,
    hashtags: post.hashtags,
    format: post.format,
    platforms: post.platforms,
    period: post.period,
    plannedFor: post.plannedFor,
    status: post.status,
    mediaPath: post.mediaPath,
    published: post.published,
  };
}

/**
 * Appends one history row, after the change it describes has been saved.
 *
 * Carried over from WBT's recordRevision: a history row failing must never undo
 * a real edit, and a row is never written for a change that did not happen.
 */
async function record(supabase: Supabase, userId: string, post: SocialPost, action: HistoryAction, previous: SocialPost | null, snapshot: SocialPost | null) {
  try {
    await supabase.from('social_post_revisions').insert({
      user_id: userId,
      post_id: post.id,
      post_title: post.title.slice(0, 120) || 'Untitled',
      action,
      previous: previous ? snapshotOf(previous) : null,
      snapshot: snapshot ? snapshotOf(snapshot) : null,
    });
  } catch {
    // History is a record, not a gate.
  }
}

/** Signs every post's media in one request, for an hour. */
async function withMedia(supabase: Supabase, posts: SocialPost[]) {
  const paths = posts.flatMap((post) => (post.mediaPath ? [post.mediaPath] : []));
  if (!paths.length) return posts;
  try {
    const { data } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    const byPath = new Map((data ?? []).flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [])));
    return posts.map((post) => (post.mediaPath ? { ...post, mediaUrl: byPath.get(post.mediaPath) ?? null } : post));
  } catch {
    return posts;
  }
}

export type SocialMonth = { posts: SocialPost[]; databaseReady: boolean; loadError: boolean };

export async function listMonth(userId: string, period: string): Promise<SocialMonth> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('social_posts')
      .select(COLUMNS)
      .eq('user_id', userId)
      .eq('period', period)
      .order('planned_for', { ascending: true, nullsFirst: false })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return { posts: [], databaseReady: !isMissingTable(error.code), loadError: !isMissingTable(error.code) };
    return { posts: await withMedia(supabase, (data ?? []).map(toPost)), databaseReady: true, loadError: false };
  } catch {
    return { posts: [], databaseReady: true, loadError: true };
  }
}

async function readPost(supabase: Supabase, userId: string, id: string) {
  const { data, error } = await supabase.from('social_posts').select(COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new SocialError(isMissingTable(error.code) ? SETUP_MESSAGE : 'That post could not be loaded.');
  return data ? toPost(data) : null;
}

export async function getPost(userId: string, id: string) {
  const supabase = await createClient();
  const post = await readPost(supabase, userId, id);
  return post ? (await withMedia(supabase, [post]))[0] : null;
}

async function mustRead(supabase: Supabase, userId: string, id: string) {
  const post = await readPost(supabase, userId, id);
  if (!post) throw new SocialError('That post no longer exists.');
  return post;
}

/**
 * Adds a post. A caller-chosen id makes this idempotent: the same id sent
 * twice (a double tap on Save) returns the post the first request made.
 */
export async function insertPost(userId: string, input: NewPost, action: 'created' | 'ai_draft' = 'created') {
  const supabase = await createClient();
  const row = {
    ...(input.id ? { id: input.id } : {}),
    user_id: userId,
    period: input.period,
    title: input.title,
    headline: input.headline,
    caption: input.caption,
    hashtags: input.hashtags,
    format: input.format,
    platforms: input.platforms,
    planned_for: input.plannedFor,
    status: input.status ?? 'draft',
    source: input.source ?? 'manual',
    media_path: input.mediaPath ?? null,
    media_type: input.mediaType ?? null,
  };
  const { data, error } = await supabase.from('social_posts').insert(row).select(COLUMNS).single();
  if (error) {
    if (error.code === '23505' && input.id) {
      const existing = await readPost(supabase, userId, input.id);
      if (existing) return (await withMedia(supabase, [existing]))[0];
    }
    throw new SocialError(isMissingTable(error.code) ? SETUP_MESSAGE : 'That post could not be saved.');
  }
  const post = toPost(data);
  await record(supabase, userId, post, action, null, post);
  return (await withMedia(supabase, [post]))[0];
}

const PATCH_COLUMN: Record<keyof PostPatch, string> = {
  period: 'period', title: 'title', headline: 'headline', caption: 'caption', hashtags: 'hashtags', format: 'format',
  platforms: 'platforms', plannedFor: 'planned_for', mediaPath: 'media_path', mediaType: 'media_type', position: 'position', status: 'status',
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Saves an edit. Nothing changed means nothing is written, history included.
 *
 * A ready post whose words, media or format change drops back to draft (WBT's
 * "an edit un-approves"), and an AI draft becomes the user's once they touch
 * its title or caption. A published post is locked until it is unpublished.
 */
export async function updatePost(userId: string, id: string, patch: PostPatch, action?: 'edited' | 'moved') {
  const supabase = await createClient();
  const before = await mustRead(supabase, userId, id);
  if (before.status === 'published') throw new SocialError('This post is published. Mark it as not published to change it.');

  const changes: Partial<SocialPost> = {};
  for (const key of Object.keys(patch) as (keyof PostPatch)[]) {
    if (patch[key] === undefined || same(patch[key], before[key])) continue;
    (changes as Record<string, unknown>)[key] = patch[key];
  }
  if (!Object.keys(changes).length) return (await withMedia(supabase, [before]))[0];
  if (changes.status && before.status === 'ready') {
    // Idea/draft moves through here; a ready post leaves ready only by an edit or unready.
    delete changes.status;
  }
  if (before.status === 'ready' && editUnreadies(before, changes)) changes.status = 'draft';
  const touchedWords = changes.title !== undefined || changes.caption !== undefined;

  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) row[PATCH_COLUMN[key as keyof PostPatch]] = value;
  if (touchedWords && before.source === 'ai') row.source = 'manual';
  if (!Object.keys(row).length) return (await withMedia(supabase, [before]))[0];

  // Only while it is still what we read: a post published in another tab is not overwritten.
  const { data, error } = await supabase
    .from('social_posts')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', before.status)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === '23514') throw new SocialError('Pick a day inside the post’s month.');
    throw new SocialError(isMissingTable(error.code) ? SETUP_MESSAGE : 'That post could not be saved.');
  }
  if (!data) throw new SocialError('This post changed somewhere else. Refresh and try again.');
  const after = toPost(data);
  await record(supabase, userId, after, action ?? (changes.period ? 'moved' : 'edited'), before, after);
  return (await withMedia(supabase, [after]))[0];
}

/**
 * Moves a post between idea, draft, ready and published.
 *
 * Ready is earned: readyProblem() must pass. Published needs ready first, as
 * WBT needed approval first, and unpublishing returns the post to ready.
 * Asking for the status a post already has is a no-op, so a double tap is harmless.
 */
export async function setStatus(userId: string, id: string, status: SocialStatus, published?: { platform: string; link: string | null }) {
  const supabase = await createClient();
  const before = await mustRead(supabase, userId, id);
  if (before.status === status) return (await withMedia(supabase, [before]))[0];

  let row: Record<string, unknown>;
  let action: HistoryAction;
  if (status === 'published') {
    if (before.status !== 'ready') throw new SocialError('Mark the post ready before recording where it went out.');
    if (!published) throw new SocialError('Choose where it was published.');
    row = { status, published_at: new Date().toISOString(), published_platform: published.platform, published_link: published.link };
    action = 'published';
  } else if (before.status === 'published') {
    if (status !== 'ready') throw new SocialError('Mark it as not published first.');
    row = { status: 'ready', published_at: null, published_platform: null, published_link: null };
    action = 'unpublished';
  } else if (status === 'ready') {
    const problem = readyProblem(before);
    if (problem) throw new SocialError(problem);
    row = { status };
    action = 'ready';
  } else {
    row = { status };
    action = before.status === 'ready' ? 'unready' : 'edited';
  }

  const { data, error } = await supabase
    .from('social_posts')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', before.status)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new SocialError(isMissingTable(error.code) ? SETUP_MESSAGE : 'That post could not be updated.');
  if (!data) {
    // Someone (another tab, a second tap) got there first. If it already has the status asked for, that is success.
    const now = await mustRead(supabase, userId, id);
    if (now.status === status) return (await withMedia(supabase, [now]))[0];
    throw new SocialError('This post changed somewhere else. Refresh and try again.');
  }
  const after = toPost(data);
  await record(supabase, userId, after, action, before, after);
  return (await withMedia(supabase, [after]))[0];
}

export async function deletePost(userId: string, id: string) {
  const supabase = await createClient();
  const before = await readPost(supabase, userId, id);
  if (!before) return;
  const { error } = await supabase.from('social_posts').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new SocialError('That post could not be deleted.');
  if (before.mediaPath) await removeMediaFiles([before.mediaPath]);
  await record(supabase, userId, before, 'deleted', before, null);
}

export async function listHistory(userId: string, id: string, limit = 30): Promise<SocialRevision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_post_revisions')
    .select('id,action,previous,snapshot,created_at')
    .eq('user_id', userId)
    .eq('post_id', id)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new SocialError(isMissingTable(error.code) ? SETUP_MESSAGE : 'History could not be loaded.');
  return (data ?? []).map((row) => ({
    id: String(row.id),
    action: String(row.action),
    previous: (row.previous ?? null) as Record<string, unknown> | null,
    snapshot: (row.snapshot ?? null) as Record<string, unknown> | null,
    createdAt: String(row.created_at),
  }));
}

export async function signedMediaUrl(path: string) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** A one-time upload URL for a path the server chose. The browser uploads straight to Storage. */
export async function createMediaUpload(path: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new SocialError('The upload could not be started. Check the social migration is applied.');
  return { path: data.path, token: data.token };
}

/** Whether an uploaded file really exists at this path before a post points at it. */
export async function mediaExists(path: string) {
  const supabase = await createClient();
  const slash = path.lastIndexOf('/');
  const { data, error } = await supabase.storage.from(SOCIAL_BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  return !error && Boolean(data?.some((item) => item.name === path.slice(slash + 1)));
}

/** Best-effort: a file left behind is wasted space, not a broken post. */
export async function removeMediaFiles(paths: string[]) {
  if (!paths.length) return;
  try {
    const supabase = await createClient();
    await supabase.storage.from(SOCIAL_BUCKET).remove(paths);
  } catch {
    // Nothing to tell the user.
  }
}

/** Copies a file to a new path for a duplicated post; null when the copy fails. */
export async function copyMediaFile(from: string, to: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.storage.from(SOCIAL_BUCKET).copy(from, to);
    return error ? null : to;
  } catch {
    return null;
  }
}
