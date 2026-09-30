import 'server-only';

import { callMeta, MetaError } from '@/lib/meta/client';
import { listConnections, markReconnect, usableToken } from '@/lib/meta/connection';
import { normalizeCaption } from '@/lib/meta/match';
import {
  claimPublication, clearDismissed, completePublication, dropPublication, dropSettledPublication, getPublication,
  listPublications, markSent, setContainer, type PublicationRow,
} from '@/lib/meta/publications';
import { publishDecision } from '@/lib/meta/publish-state';
import { containerSpec, publishProblem, sentText } from '@/lib/meta/publish-rules';
import { containerStatus, createContainer, mediaDetails, monthMedia, publishContainer } from '@/lib/meta/requests';
import { META_LABEL, type MetaPlatform, type PublishResult } from '@/lib/meta/types';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { getPost, signedMediaUrl } from '@/lib/social/repository';

type Access = { accountId: string; token: string };

const failed = (message: string): PublishResult => ({ success: false, message });
const processing = (platform: MetaPlatform, id: string): PublishResult => ({ success: true, message: `${META_LABEL[platform]} is still processing it.`, state: 'processing', publicationId: id });
const mayBeLive = (platform: MetaPlatform) => failed(`${META_LABEL[platform]} didn’t confirm, so it may already be live. Check ${META_LABEL[platform]}; Orbis will record it the next time Social opens.`);
const metaTime = (value: string) => new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();

function metaFailure(error: unknown, platform: MetaPlatform) {
  if (error instanceof MetaError) {
    if (error.kind === 'unavailable') return `${META_LABEL[platform]} isn’t responding right now. Try again in a minute.`;
    if (error.kind === 'auth') return `Reconnect ${META_LABEL[platform]} in Settings, then try again.`;
    return `${META_LABEL[platform]} said: ${error.message}`;
  }
  return `${META_LABEL[platform]} could not publish this. Try again.`;
}

async function status(platform: MetaPlatform, containerId: string, access: Access) {
  const body = await callMeta(containerStatus(platform, containerId, access.token));
  return {
    code: ((body.status_code ?? body.status) as string | undefined) ?? null,
    reason: typeof body.error_message === 'string' ? body.error_message.toLowerCase().replace(/_/g, ' ') : null,
  };
}

/**
 * A container Meta reports as PUBLISHED, found among the account's recent
 * posts: by its caption, or for an Instagram story (no caption) the newest
 * story since the claim. null while it can't be found yet.
 */
async function findPublished(userId: string, row: PublicationRow, access: Access) {
  const post = await getPost(userId, row.postId);
  if (!post) return null;
  const since = Math.floor(new Date(row.createdAt).getTime() / 1000) - 120;
  const listed = await callMeta(monthMedia(row.platform, access.accountId, access.token, { since, until: Math.floor(Date.now() / 1000) + 60 }));
  const items = ((listed.data as Array<Record<string, unknown>>) ?? []).map((item) => ({
    id: item.id as string, caption: ((item.caption ?? item.text) as string | undefined) ?? '', permalink: (item.permalink as string | undefined) ?? null,
    timestamp: item.timestamp as string, productType: (item.media_product_type as string | undefined) ?? null,
  }));
  const text = sentText(post, row.platform);
  const want = text === null ? null : normalizeCaption(text).slice(0, 80);
  const found = want === null
    ? items.filter((item) => item.productType === 'STORY').sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
    : items.find((item) => normalizeCaption(item.caption).startsWith(want));
  return found ?? null;
}

async function publishNow(userId: string, row: PublicationRow, access: Access): Promise<PublishResult> {
  const platform = row.platform;
  // Only one request sends the publish call; the rest wait for its outcome.
  if (!(await markSent(row.id, new Date()))) return processing(platform, row.id);
  let externalId: string;
  try {
    const published = await callMeta(publishContainer(platform, access.accountId, access.token, row.containerId as string));
    externalId = published.id as string;
  } catch (error) {
    if (error instanceof MetaError && error.kind === 'auth') await markReconnect(userId, platform);
    // The call was sent: whatever Meta said, the claim stays until its status settles.
    return mayBeLive(platform);
  }
  let permalink: string | null = null;
  let publishedAt = new Date().toISOString();
  try {
    const details = await callMeta(mediaDetails(platform, externalId, access.token));
    permalink = (details.permalink as string | undefined) ?? null;
    if (typeof details.timestamp === 'string') publishedAt = metaTime(details.timestamp);
  } catch {
    // The post is out; the link can come from the next stats read.
  }
  try {
    await completePublication(userId, { id: row.id, postId: row.postId, platform }, { externalId, permalink, publishedAt, source: 'orbis' });
  } catch {
    // Live, but not recorded yet: the claim stays sent, and the next check recovers it as PUBLISHED.
    return failed(`Published on ${META_LABEL[platform]}, but Orbis couldn’t record it yet. It will the next time Social opens.`);
  }
  return { success: true, message: `Published on ${META_LABEL[platform]}.`, state: 'published', permalink };
}

/** Moves a processing publication on by one step. Safe to call from any number of places at once. */
export async function finishProcessing(userId: string, row: PublicationRow, access: Access): Promise<PublishResult> {
  const platform = row.platform;
  let code: string | null = null;
  let reason: string | null = null;
  if (row.containerId) {
    try {
      ({ code, reason } = await status(platform, row.containerId, access));
    } catch (error) {
      if (error instanceof MetaError && error.kind === 'auth') {
        await markReconnect(userId, platform);
        return failed(metaFailure(error, platform));
      }
      // Status unknown: decided below with code = null.
    }
  }
  switch (publishDecision(row, code, new Date())) {
    case 'wait':
      return processing(platform, row.id);
    case 'publish':
      return publishNow(userId, row, access);
    case 'recover': {
      const found = await findPublished(userId, row, access).catch(() => null);
      if (!found) return processing(platform, row.id);
      await completePublication(userId, { id: row.id, postId: row.postId, platform }, { externalId: found.id, permalink: found.permalink, publishedAt: metaTime(found.timestamp), source: 'orbis' });
      return { success: true, message: `Published on ${META_LABEL[platform]}.`, state: 'published', permalink: found.permalink };
    }
    case 'keep':
      return mayBeLive(platform);
    case 'drop':
      if (row.sentAt) await dropSettledPublication(row.id);
      else await dropPublication(row.id);
      return failed(row.containerId
        ? `${META_LABEL[platform]} couldn’t use this file${reason ? ` (${reason})` : ''}. Nothing was posted.`
        : 'Publishing didn’t finish. Nothing was posted; try again.');
  }
}

/**
 * Publishes a saved, ready post the person confirmed. `confirmedAt` is the
 * post's updatedAt as the confirm sheet showed it: a post changed since then
 * is refused, so what goes out is exactly what was seen.
 */
export async function startPublish(userId: string, postId: string, platform: MetaPlatform, confirmedAt: string): Promise<PublishResult> {
  const post = await getPost(userId, postId);
  if (!post) return failed('That post no longer exists.');
  const connection = (await listConnections(userId)).find((item) => item.platform === platform) ?? null;
  const publications = await listPublications(userId, [postId]);
  if (!publications) return failed('Orbis couldn’t check this post’s publishing record. Try again.');
  const existing = publications.find((row) => row.platform === platform && row.status !== 'dismissed') ?? null;
  const problem = publishProblem(post, platform, {
    connection: connection?.status ?? null,
    publication: existing?.status === 'published' || existing?.status === 'processing' ? existing.status : null,
    dirty: false,
    changed: post.updatedAt !== confirmedAt,
  });
  if (problem) return failed(problem);

  const refusal = await rateLimitRefusal(userId, platform === 'instagram' ? 'social_publish_instagram' : 'social_publish_threads');
  if (refusal) return failed(refusal);
  const access = await usableToken(userId, platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[platform]} in Settings, then try again.`);

  await clearDismissed(userId, postId, platform);
  const claim = await claimPublication(userId, postId, platform);
  if (claim === 'taken') return failed(`Publishing on ${META_LABEL[platform]} is already under way.`);
  if (claim === 'failed') return failed('Orbis couldn’t start publishing. Try again.');
  try {
    const mediaUrl = post.mediaPath ? await signedMediaUrl(post.mediaPath) : null;
    if (post.mediaPath && !mediaUrl) {
      await dropPublication(claim.id);
      return failed('The picture or video could not be prepared. Try again.');
    }
    const created = await callMeta(createContainer(platform, access.accountId, access.token, containerSpec(post, platform, mediaUrl)));
    await setContainer(claim.id, created.id as string);
  } catch (error) {
    if (error instanceof MetaError && error.kind === 'auth') await markReconnect(userId, platform);
    // Nothing has been published yet (no publish call was sent), so the claim can go.
    await dropPublication(claim.id);
    return failed(metaFailure(error, platform));
  }
  const row = await getPublication(userId, claim.id);
  if (!row) return failed('Publishing didn’t finish. Nothing was posted; try again.');
  return finishProcessing(userId, row, access);
}

export async function checkPublish(userId: string, publicationId: string): Promise<PublishResult> {
  const row = await getPublication(userId, publicationId);
  if (!row) return failed('Publishing didn’t finish. Nothing was posted; try again.');
  if (row.status === 'published') return { success: true, message: `Published on ${META_LABEL[row.platform]}.`, state: 'published', permalink: null };
  const access = await usableToken(userId, row.platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[row.platform]} in Settings, then try again.`);
  return finishProcessing(userId, row, access);
}
