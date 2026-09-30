import 'server-only';

import { callMeta, MetaError } from '@/lib/meta/client';
import { markReconnect, listConnections, usableToken } from '@/lib/meta/connection';
import { claimPublication, completePublication, dropPublication, listPublications, setContainer, type PublicationRow } from '@/lib/meta/publications';
import { containerSpec, publishProblem } from '@/lib/meta/publish-rules';
import { containerStatus, createContainer, mediaDetails, publishContainer } from '@/lib/meta/requests';
import { META_LABEL, type MetaPlatform, type PublishResult } from '@/lib/meta/types';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { getPost, signedMediaUrl } from '@/lib/social/repository';
import { createAdminClient } from '@/lib/supabase/admin';

const failed = (message: string): PublishResult => ({ success: false, message });

function metaFailure(error: unknown, platform: MetaPlatform) {
  if (error instanceof MetaError) {
    if (error.kind === 'unavailable') return `${META_LABEL[platform]} isn’t responding right now. Try again in a minute.`;
    if (error.kind === 'auth') return `Reconnect ${META_LABEL[platform]} in Settings, then try again.`;
    return `${META_LABEL[platform]} said: ${error.message}`;
  }
  return `${META_LABEL[platform]} could not publish this. Try again.`;
}

/** Publishes a FINISHED container and records it; reports processing or failure otherwise. */
export async function finishProcessing(userId: string, row: PublicationRow, access: { accountId: string; token: string }): Promise<PublishResult> {
  const platform = row.platform;
  if (!row.containerId) {
    await dropPublication(row.id);
    return failed('Publishing didn’t finish. Try again.');
  }
  try {
    const status = await callMeta(containerStatus(platform, row.containerId, access.token));
    const code = (status.status_code ?? status.status) as string | undefined;
    if (code === 'IN_PROGRESS') return { success: true, message: `${META_LABEL[platform]} is still processing it.`, state: 'processing', publicationId: row.id };
    if (code !== 'FINISHED') {
      await dropPublication(row.id);
      const reason = typeof status.error_message === 'string' ? ` (${status.error_message.toLowerCase().replace(/_/g, ' ')})` : '';
      return failed(`${META_LABEL[platform]} couldn’t use this file${reason}. Nothing was posted.`);
    }
    const published = await callMeta(publishContainer(platform, access.accountId, access.token, row.containerId));
    const externalId = published.id as string;
    let permalink: string | null = null;
    let publishedAt = new Date().toISOString();
    try {
      const details = await callMeta(mediaDetails(platform, externalId, access.token));
      permalink = (details.permalink as string | undefined) ?? null;
      if (typeof details.timestamp === 'string') publishedAt = new Date(details.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();
    } catch {
      // The post is out; the link can come from the next stats read.
    }
    await completePublication(userId, { id: row.id, postId: row.postId, platform }, { externalId, permalink, publishedAt, source: 'orbis' });
    return { success: true, message: `Published on ${META_LABEL[platform]}.`, state: 'published', permalink };
  } catch (error) {
    if (error instanceof MetaError && error.kind === 'auth') await markReconnect(userId, platform);
    // A publish call that failed may still have posted; keep the claim only while Meta could still be processing.
    if (!(error instanceof MetaError && error.kind === 'unavailable')) await dropPublication(row.id);
    return failed(metaFailure(error, platform));
  }
}

export async function startPublish(userId: string, postId: string, platform: MetaPlatform): Promise<PublishResult> {
  const post = await getPost(userId, postId);
  if (!post) return failed('That post no longer exists.');
  const connection = (await listConnections(userId)).find((item) => item.platform === platform) ?? null;
  const existing = (await listPublications(userId, [postId])).find((row) => row.platform === platform) ?? null;
  const problem = publishProblem(post, platform, { connection: connection?.status ?? null, publication: existing?.status ?? null, dirty: false });
  if (problem) return failed(problem);

  const refusal = await rateLimitRefusal(userId, platform === 'instagram' ? 'social_publish_instagram' : 'social_publish_threads');
  if (refusal) return failed(refusal);
  const access = await usableToken(userId, platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[platform]} in Settings, then try again.`);

  const id = await claimPublication(userId, postId, platform);
  if (!id) return failed(`Publishing on ${META_LABEL[platform]} is already under way.`);
  try {
    const mediaUrl = post.mediaPath ? await signedMediaUrl(post.mediaPath) : null;
    if (post.mediaPath && !mediaUrl) {
      await dropPublication(id);
      return failed('The picture or video could not be prepared. Try again.');
    }
    const created = await callMeta(createContainer(platform, access.accountId, access.token, containerSpec(post, platform, mediaUrl)));
    const containerId = created.id as string;
    await setContainer(id, containerId);
    return await finishProcessing(userId, { id, postId, platform, status: 'processing', containerId, externalId: null, createdAt: new Date().toISOString() }, access);
  } catch (error) {
    await dropPublication(id);
    return failed(metaFailure(error, platform));
  }
}

export async function checkPublish(userId: string, publicationId: string): Promise<PublishResult> {
  const { data } = await createAdminClient().from('social_publications').select('id,post_id,platform,status,container_id,external_id,created_at').eq('id', publicationId).eq('user_id', userId).maybeSingle();
  if (!data) return failed('Publishing didn’t finish. Try again.');
  if (data.status === 'published') return { success: true, message: `Published on ${META_LABEL[data.platform as MetaPlatform]}.`, state: 'published', permalink: null };
  const row: PublicationRow = { id: data.id, postId: data.post_id, platform: data.platform, status: data.status, containerId: data.container_id, externalId: data.external_id, createdAt: data.created_at };
  const access = await usableToken(userId, row.platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[row.platform]} in Settings, then try again.`);
  return finishProcessing(userId, row, access);
}
