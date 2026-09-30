import 'server-only';

import { recordPublishedElsewhere, setStatus, getPost } from '@/lib/social/repository';
import type { MetaPlatform } from '@/lib/meta/types';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicationRow = { id: string; postId: string; platform: MetaPlatform; status: 'processing' | 'published'; containerId: string | null; externalId: string | null; createdAt: string };

const toRow = (row: Record<string, unknown>): PublicationRow => ({
  id: row.id as string, postId: row.post_id as string, platform: row.platform as MetaPlatform, status: row.status as PublicationRow['status'],
  containerId: (row.container_id as string | null) ?? null, externalId: (row.external_id as string | null) ?? null, createdAt: row.created_at as string,
});

export async function listPublications(userId: string, postIds: string[]) {
  if (!postIds.length) return [];
  const { data, error } = await createAdminClient().from('social_publications').select('id,post_id,platform,status,container_id,external_id,created_at').eq('user_id', userId).in('post_id', postIds);
  if (error) return [];
  return (data ?? []).map(toRow);
}

/** Claims the (post, platform) pair. null when a publication already exists, so a second tap never makes a second post. */
export async function claimPublication(userId: string, postId: string, platform: MetaPlatform) {
  const { data, error } = await createAdminClient().from('social_publications').insert({ user_id: userId, post_id: postId, platform, status: 'processing', source: 'orbis' }).select('id').single();
  if (error) return null;
  return data.id as string;
}

export async function setContainer(id: string, containerId: string) {
  await createAdminClient().from('social_publications').update({ container_id: containerId }).eq('id', id);
}

export async function dropPublication(id: string) {
  await createAdminClient().from('social_publications').delete().eq('id', id).eq('status', 'processing');
}

export async function deletePostPublications(userId: string, postId: string) {
  await createAdminClient().from('social_publications').delete().eq('user_id', userId).eq('post_id', postId);
}

/**
 * Records that a post is out on a platform. The first platform also sets the
 * post itself to published with that time and link; a second only adds history.
 */
export async function completePublication(userId: string, publication: { id: string | null; postId: string; platform: MetaPlatform }, result: { externalId: string; permalink: string | null; publishedAt: string; source: 'orbis' | 'matched' }) {
  const admin = createAdminClient();
  const values = { status: 'published', external_id: result.externalId, permalink: result.permalink, published_at: result.publishedAt, source: result.source };
  const { error } = publication.id
    ? await admin.from('social_publications').update(values).eq('id', publication.id)
    : await admin.from('social_publications').insert({ ...values, user_id: userId, post_id: publication.postId, platform: publication.platform });
  // 23505: another run recorded this pair first; that is the same outcome.
  if (error && error.code !== '23505') throw new Error(`Recording the publication failed (${error.code}).`);
  const post = await getPost(userId, publication.postId);
  if (!post) return;
  if (post.status === 'ready') await setStatus(userId, post.id, 'published', { platform: publication.platform, link: result.permalink, at: result.publishedAt });
  else if (post.status === 'published') await recordPublishedElsewhere(userId, post.id, publication.platform);
}
