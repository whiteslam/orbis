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
 *
 * Instagram goes through Instagram Login (instagram.com and graph.instagram.com),
 * not Facebook Login. Facebook Login's instagram_basic and
 * instagram_content_publish are refused as "Invalid Scopes" by apps set up the
 * way Meta sets them up now, and it needed a Facebook Page in between. Instagram
 * Login has neither problem, only a Business or Creator account. Like Threads,
 * it has its own app id and secret, separate from the Meta app's.
 */
export type SocialPlatformId = 'instagram' | 'threads';

const INSTAGRAM = 'https://graph.instagram.com/v21.0';
const INSTAGRAM_TOKEN = 'https://graph.instagram.com';
const THREADS = 'https://graph.threads.net/v1.0';

export class SocialAuthError extends Error {}
export class SocialPublishError extends Error {}

export function metaConfigured(platform: SocialPlatformId) {
  return platform === 'instagram'
    ? Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim())
    : Boolean(process.env.THREADS_APP_ID?.trim() && process.env.THREADS_APP_SECRET?.trim());
}

function credentials(platform: SocialPlatformId) {
  const id = (platform === 'instagram' ? process.env.INSTAGRAM_APP_ID : process.env.THREADS_APP_ID)?.trim();
  const secret = (platform === 'instagram' ? process.env.INSTAGRAM_APP_SECRET : process.env.THREADS_APP_SECRET)?.trim();
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
 * account cannot connect. The insights scopes feed the Social tab's numbers;
 * each one also has to be added to the app in the Meta dashboard, or Meta
 * refuses the whole login as "Invalid Scopes".
 */
export function socialLoginUrl(platform: SocialPlatformId, siteUrl: string, state: string) {
  const { id } = credentials(platform);
  const redirect = encodeURIComponent(socialRedirectUri(platform, siteUrl));
  if (platform === 'threads') {
    const scope = encodeURIComponent('threads_basic,threads_content_publish,threads_manage_insights');
    return `https://threads.net/oauth/authorize?client_id=${id}&redirect_uri=${redirect}&scope=${scope}&response_type=code&state=${state}`;
  }
  const scope = encodeURIComponent('instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights');
  return `https://www.instagram.com/oauth/authorize?client_id=${id}&redirect_uri=${redirect}&scope=${scope}&response_type=code&state=${state}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; error?: { message?: string } | string; error_description?: string };

async function readJson<T>(response: Response, what: string): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string } | string; error_message?: string }) | null;
  if (!response.ok || !body || body.error || body.error_message) {
    // Graph errors nest the message; Instagram Login's token endpoint puts it at the top.
    const message = (typeof body?.error === 'object' ? body.error?.message : undefined) ?? body?.error_message;
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
    const shortForm = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: code.replace(/#_$/, '') });
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

  // Instagram tacks "#_" onto the code it returns; it is not part of the code.
  const form = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: code.replace(/#_$/, '') });
  const short = await readJson<TokenResponse & { user_id?: string | number; data?: Array<{ access_token?: string }> }>(
    await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form, cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Connecting Instagram',
  );
  // Answered either flat or wrapped in data[], depending on the API version.
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new SocialAuthError('Instagram did not return a token.');

  const long = await readJson<TokenResponse>(
    await fetch(`${INSTAGRAM_TOKEN}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(shortToken)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Connecting Instagram',
  );
  const token = long.access_token ?? shortToken;

  // user_id is the professional account id that publishing is addressed to;
  // id is app-scoped and is only the fallback.
  const me = await readJson<{ id?: string; user_id?: string | number; username?: string; account_type?: string }>(
    await fetch(`${INSTAGRAM}/me?fields=id,user_id,username,account_type&access_token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    'Reading your Instagram account',
  );
  const accountId = me.user_id ? String(me.user_id) : me.id;
  if (!accountId) throw new SocialAuthError('Instagram did not return an account.');
  if (me.account_type === 'PERSONAL') {
    throw new SocialAuthError('This is a personal Instagram account. Switch it to Business or Creator in Instagram settings, then connect again.');
  }
  return { accessToken: token, accountId, username: me.username ?? null, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
}

export type PublishInput = { accessToken: string; accountId: string; caption: string; mediaUrl: string | null; mediaType: 'image' | 'video' | null };

/** Creates the container, then publishes it. Returns the published post's id. */
export async function publishSocialPost(platform: SocialPlatformId, input: PublishInput): Promise<string> {
  const base = platform === 'threads' ? THREADS : INSTAGRAM;
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
