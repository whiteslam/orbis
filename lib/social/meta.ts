import 'server-only';

/**
 * Instagram and Threads publishing, through Meta's Graph APIs.
 *
 * Both work the same way and neither accepts an upload: you hand Meta a URL, it
 * fetches the media itself, and publishing is two calls rather than one. Create
 * a container, then publish the container. That is why the social-media bucket's
 * signed URLs are what gets sent, and why a signed URL has to still be valid
 * when Meta goes to fetch it.
 *
 * Tokens are long-lived (about 60 days) and refreshable while still valid. A
 * token left past its expiry cannot be refreshed and needs the user back, so
 * expiry is stored rather than assumed.
 */
export type SocialPlatformId = 'instagram' | 'threads';

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS = 'https://graph.threads.net/v1.0';

export class SocialAuthError extends Error {}
export class SocialPublishError extends Error {}

export function metaConfigured(platform: SocialPlatformId) {
  return platform === 'instagram'
    ? Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim())
    : Boolean(process.env.THREADS_APP_ID?.trim() && process.env.THREADS_APP_SECRET?.trim());
}

function credentials(platform: SocialPlatformId) {
  const id = (platform === 'instagram' ? process.env.META_APP_ID : process.env.THREADS_APP_ID)?.trim();
  const secret = (platform === 'instagram' ? process.env.META_APP_SECRET : process.env.THREADS_APP_SECRET)?.trim();
  if (!id || !secret) throw new SocialAuthError(`${platform === 'instagram' ? 'Instagram' : 'Threads'} is not configured on this server.`);
  return { id, secret };
}

export const socialRedirectUri = (platform: SocialPlatformId, siteUrl: string) =>
  `${siteUrl.replace(/\/+$/, '')}/auth/social/${platform}/callback`;

/**
 * Where the user authorises Orbis.
 *
 * Both scopes named here need Meta App Review before they work for anyone but
 * the app's own testers, which is worth knowing before wondering why a live
 * account cannot connect.
 */
export function socialLoginUrl(platform: SocialPlatformId, siteUrl: string, state: string) {
  const { id } = credentials(platform);
  const redirect = encodeURIComponent(socialRedirectUri(platform, siteUrl));
  if (platform === 'threads') {
    const scope = encodeURIComponent('threads_basic,threads_content_publish');
    return `https://threads.net/oauth/authorize?client_id=${id}&redirect_uri=${redirect}&scope=${scope}&response_type=code&state=${state}`;
  }
  const scope = encodeURIComponent('instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management');
  return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${id}&redirect_uri=${redirect}&scope=${scope}&response_type=code&state=${state}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; error?: { message?: string } | string; error_description?: string };

async function readJson<T>(response: Response, what: string): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !body || body.error) {
    const message = typeof body?.error === 'object' ? body.error?.message : undefined;
    throw new SocialAuthError(message ?? `${what} failed. Try connecting again.`);
  }
  return body;
}

export type SocialSession = { accessToken: string; accountId: string; username: string | null; expiresAt: Date | null };

/** Trades the one-time code for a long-lived token and the account it can publish to. */
export async function exchangeSocialCode(platform: SocialPlatformId, code: string, siteUrl: string): Promise<SocialSession> {
  const { id, secret } = credentials(platform);
  const redirectUri = socialRedirectUri(platform, siteUrl);

  if (platform === 'threads') {
    const shortForm = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code });
    const short = await readJson<TokenResponse & { user_id?: string | number }>(
      await fetch(`${THREADS}/oauth/access_token`, { method: 'POST', body: shortForm, cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      'Connecting Threads',
    );
    if (!short.access_token) throw new SocialAuthError('Threads did not return a token.');

    const long = await readJson<TokenResponse>(
      await fetch(`${THREADS}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(short.access_token)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      'Connecting Threads',
    );
    const token = long.access_token ?? short.access_token;
    const me = await readJson<{ id?: string; username?: string }>(
      await fetch(`${THREADS}/me?fields=id,username&access_token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      'Reading your Threads account',
    );
    if (!me.id) throw new SocialAuthError('Threads did not return an account.');
    return { accessToken: token, accountId: me.id, username: me.username ?? null, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
  }

  const short = await readJson<TokenResponse>(
    await fetch(`${GRAPH}/oauth/access_token?client_id=${id}&client_secret=${encodeURIComponent(secret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Connecting Instagram',
  );
  if (!short.access_token) throw new SocialAuthError('Instagram did not return a token.');

  const long = await readJson<TokenResponse>(
    await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${id}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(short.access_token)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Connecting Instagram',
  );
  const token = long.access_token ?? short.access_token;

  // Instagram publishes through a Business account attached to a Facebook Page,
  // so the Page is the only route to the account id. A personal Instagram has
  // none, which is the usual reason this step finds nothing.
  const pages = await readJson<{ data?: Array<{ instagram_business_account?: { id?: string; username?: string } }> }>(
    await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Finding your Instagram account',
  );
  const account = (pages.data ?? []).map((page) => page.instagram_business_account).find((item) => item?.id);
  if (!account?.id) {
    throw new SocialAuthError('No Instagram Business account is linked to your Facebook Page. Instagram can only publish from a Business or Creator account.');
  }
  return { accessToken: token, accountId: account.id, username: account.username ?? null, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
}

export type PublishInput = { accessToken: string; accountId: string; caption: string; mediaUrl: string | null; mediaType: 'image' | 'video' | null };

/** Creates the container, then publishes it. Returns the published post's id. */
export async function publishSocialPost(platform: SocialPlatformId, input: PublishInput): Promise<string> {
  const base = platform === 'threads' ? THREADS : GRAPH;
  const createPath = platform === 'threads' ? `${base}/${input.accountId}/threads` : `${base}/${input.accountId}/media`;
  const publishPath = platform === 'threads' ? `${base}/${input.accountId}/threads_publish` : `${base}/${input.accountId}/media_publish`;

  const create = new URLSearchParams({ access_token: input.accessToken });
  if (platform === 'threads') {
    create.set('media_type', input.mediaUrl ? (input.mediaType === 'video' ? 'VIDEO' : 'IMAGE') : 'TEXT');
    create.set('text', input.caption);
    if (input.mediaUrl) create.set(input.mediaType === 'video' ? 'video_url' : 'image_url', input.mediaUrl);
  } else {
    // Instagram has no text-only post: a caption needs something to sit under.
    if (!input.mediaUrl) throw new SocialPublishError('Instagram needs a picture or a video. Add one to this post first.');
    create.set('caption', input.caption);
    create.set(input.mediaType === 'video' ? 'video_url' : 'image_url', input.mediaUrl);
    if (input.mediaType === 'video') create.set('media_type', 'REELS');
  }

  let container: { id?: string };
  try {
    container = await readJson<{ id?: string }>(
      await fetch(createPath, { method: 'POST', body: create, cache: 'no-store', signal: AbortSignal.timeout(30_000) }),
      'Preparing the post',
    );
  } catch (error) {
    throw new SocialPublishError(error instanceof Error ? error.message : 'The post could not be prepared.');
  }
  if (!container.id) throw new SocialPublishError('The post could not be prepared.');

  // Video containers are processed asynchronously, so publishing straight away
  // fails with "media not ready". A short wait covers the common case.
  if (input.mediaType === 'video') await new Promise((resolve) => setTimeout(resolve, 8_000));

  try {
    const published = await readJson<{ id?: string }>(
      await fetch(publishPath, { method: 'POST', body: new URLSearchParams({ access_token: input.accessToken, creation_id: container.id }), cache: 'no-store', signal: AbortSignal.timeout(30_000) }),
      'Publishing the post',
    );
    if (!published.id) throw new SocialPublishError('The post was prepared but not published.');
    return published.id;
  } catch (error) {
    throw new SocialPublishError(error instanceof Error ? error.message : 'The post could not be published.');
  }
}
