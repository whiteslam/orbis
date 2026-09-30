import 'server-only';

import { getPost, recordPublishedElsewhere, setStatus } from '@/lib/social/repository';
import type { MetaPlatform } from '@/lib/meta/types';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicationStatus = 'processing' | 'published' | 'dismissed';
export type PublicationRow = {
  id: string; postId: string; platform: MetaPlatform; status: PublicationStatus;
  containerId: string | null; externalId: string | null; sentAt: string | null; createdAt: string;
};

const COLUMNS = 'id,post_id,platform,status,container_id,external_id,publish_sent_at,created_at';
const RESEND_AFTER_MS = 60_000;

const toRow = (row: Record<string, unknown>): PublicationRow => ({
  id: row.id as string, postId: row.post_id as string, platform: row.platform as MetaPlatform, status: row.status as PublicationStatus,
  containerId: (row.container_id as string | null) ?? null, externalId: (row.external_id as string | null) ?? null,
  sentAt: (row.publish_sent_at as string | null) ?? null, createdAt: row.created_at as string,
});

/** Every publication of these posts, or null when they could not be read (callers then change nothing). */
export async function listPublications(userId: string, postIds: string[]): Promise<PublicationRow[] | null> {
  if (!postIds.length) return [];
  const { data, error } = await createAdminClient().from('social_publications').select(COLUMNS).eq('user_id', userId).in('post_id', postIds);
  if (error) return null;
  return (data ?? []).map(toRow);
}

export async function getPublication(userId: string, id: string) {
  const { data } = await createAdminClient().from('social_publications').select(COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? toRow(data) : null;
}

/**
 * Claims the (post, platform) pair. 'taken' when a publication already exists,
 * so a second tap never makes a second post; 'failed' when it could not be written.
 */
export async function claimPublication(userId: string, postId: string, platform: MetaPlatform): Promise<{ id: string } | 'taken' | 'failed'> {
  const { data, error } = await createAdminClient().from('social_publications').insert({ user_id: userId, post_id: postId, platform, status: 'processing', source: 'orbis' }).select('id').single();
  if (error) return error.code === '23505' ? 'taken' : 'failed';
  return { id: data.id as string };
}

/** Records the container; throws if the claim is gone, so nothing is published without one. */
export async function setContainer(id: string, containerId: string) {
  const { data, error } = await createAdminClient().from('social_publications').update({ container_id: containerId }).eq('id', id).eq('status', 'processing').select('id');
  if (error || !data?.length) throw new Error('The publication claim is gone.');
}

/**
 * Marks the publish call as about to be sent. A compare-and-set: only one
 * request wins, and another may only retry once the first had a minute to land.
 */
export async function markSent(id: string, now: Date) {
  const stale = new Date(now.getTime() - RESEND_AFTER_MS).toISOString();
  const { data } = await createAdminClient().from('social_publications').update({ publish_sent_at: now.toISOString() })
    .eq('id', id).eq('status', 'processing').or(`publish_sent_at.is.null,publish_sent_at.lt."${stale}"`).select('id');
  return Boolean(data?.length);
}

/** Releases a claim. Never one whose publish call was sent: that post may be live. */
export async function dropPublication(id: string) {
  await createAdminClient().from('social_publications').delete().eq('id', id).eq('status', 'processing').is('publish_sent_at', null);
}

/** Releases a sent claim that Meta has since reported as ERROR or EXPIRED: it never went out. */
export async function dropSettledPublication(id: string) {
  await createAdminClient().from('social_publications').delete().eq('id', id).eq('status', 'processing');
}

/** "Not published": remember the choice, so the matcher does not mark it again. */
export async function dismissPostPublications(userId: string, postId: string) {
  await createAdminClient().from('social_publications').update({ status: 'dismissed' }).eq('user_id', userId).eq('post_id', postId).eq('status', 'published');
}

/** Publishing anew after a dismissal clears the old record first. */
export async function clearDismissed(userId: string, postId: string, platform: MetaPlatform) {
  await createAdminClient().from('social_publications').delete().eq('user_id', userId).eq('post_id', postId).eq('platform', platform).eq('status', 'dismissed');
}

/**
 * Records that a post is out on a platform. The first platform also sets the
 * post itself to published with that time and link; a second only adds history.
 * If the claim row vanished, the record is inserted instead: the post is out either way.
 */
export async function completePublication(userId: string, publication: { id: string | null; postId: string; platform: MetaPlatform }, result: { externalId: string; permalink: string | null; publishedAt: string; source: 'orbis' | 'matched' }) {
  const admin = createAdminClient();
  const values = { status: 'published', external_id: result.externalId, permalink: result.permalink, published_at: result.publishedAt, source: result.source };
  let written = false;
  if (publication.id) {
    const { data, error } = await admin.from('social_publications').update(values).eq('id', publication.id).select('id');
    if (error) throw new Error(`Recording the publication failed (${error.code}).`);
    written = Boolean(data?.length);
  }
  if (!written) {
    const { error } = await admin.from('social_publications').insert({ ...values, user_id: userId, post_id: publication.postId, platform: publication.platform });
    // 23505: this pair is already recorded; the same outcome.
    if (error && error.code !== '23505') throw new Error(`Recording the publication failed (${error.code}).`);
  }
  const post = await getPost(userId, publication.postId);
  if (!post) return;
  if (post.status === 'ready') await setStatus(userId, post.id, 'published', { platform: publication.platform, link: result.permalink, at: result.publishedAt });
  else if (post.status === 'published') await recordPublishedElsewhere(userId, post.id, publication.platform);
}
