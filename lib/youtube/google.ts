import 'server-only';

import { credentialEncryptionReady } from '@/lib/crypto/credentials';

// Google OAuth for YouTube publishing. It uses the same web client as Gmail
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) but not getGmailConfig(), which also
// wants Gmail-only settings. Every call takes an optional fetch, for tests.

export const youtubeStateCookieName = 'orbis-youtube-oauth-state';

const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_SCOPES = `${UPLOAD_SCOPE} ${READONLY_SCOPE}`;

/** A Google sign-in problem. `reconnect` is true when the person has to connect again. */
export class YouTubeAuthError extends Error {
  constructor(message: string, readonly reconnect = false) {
    super(message);
    this.name = 'YouTubeAuthError';
  }
}

const notConfigured = () => new YouTubeAuthError('YouTube can’t be connected on this server yet.');

function clientIdOrThrow() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw notConfigured();
  return clientId;
}

function credentials() {
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientSecret) throw notConfigured();
  return { clientId: clientIdOrThrow(), clientSecret };
}

/** True when the Google client is set and tokens can be stored encrypted. */
export function youtubeConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && credentialEncryptionReady());
}

const redirectUri = (site: string) => `${site}/auth/youtube/callback`;

export function youtubeAuthUrl(site: string, state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientIdOrThrow());
  url.searchParams.set('redirect_uri', redirectUri(site));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  // Without this Google only hands out a refresh token the first time.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

type TokenPayload = { access_token?: unknown; refresh_token?: unknown; scope?: unknown; error?: unknown };

async function postToken(form: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenPayload & { access_token: string }> {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as TokenPayload;
  if (!response.ok) {
    if (payload.error === 'invalid_grant') throw new YouTubeAuthError('Google stopped accepting Orbis’s access. Connect again.', true);
    throw new YouTubeAuthError('Google could not complete the YouTube sign-in. Try again.');
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new YouTubeAuthError('Google returned an incomplete sign-in. Try again.');
  return payload as TokenPayload & { access_token: string };
}

export async function exchangeYouTubeCode(code: string, site: string, fetchImpl: typeof fetch = fetch) {
  const { clientId, clientSecret } = credentials();
  const payload = await postToken(
    new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(site), grant_type: 'authorization_code' }),
    fetchImpl,
  );
  // Google lets people untick a permission on the consent screen.
  if (typeof payload.scope === 'string') {
    const granted = payload.scope.split(' ');
    if (!granted.includes(UPLOAD_SCOPE) || !granted.includes(READONLY_SCOPE)) {
      throw new YouTubeAuthError('Orbis needs permission to upload videos and see your channel. Connect again and allow access.');
    }
  }
  return { accessToken: payload.access_token, refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : null };
}

/** A fresh access token from the stored refresh token. */
export async function mintAccessToken(refreshToken: string, fetchImpl: typeof fetch = fetch) {
  const { clientId, clientSecret } = credentials();
  const payload = await postToken(
    new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
    fetchImpl,
  );
  return payload.access_token;
}

/**
 * Why Google refused to read the channel, in Orbis's own words. Only Google's
 * machine-readable reason is looked at, never echoed: the commonest cause by far
 * is the YouTube Data API not being switched on in the client's Cloud project.
 */
export async function channelRefusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: { status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } };
  const reasons = [
    body.error?.status,
    ...(body.error?.errors ?? []).map((one) => one.reason),
    ...(body.error?.details ?? []).map((one) => one.reason),
  ].filter((one): one is string => typeof one === 'string');
  if (reasons.some((one) => one === 'accessNotConfigured' || one === 'SERVICE_DISABLED')) {
    return 'The YouTube Data API v3 isn’t enabled in the Google Cloud project of this sign-in client. Enable it under APIs & Services → Library, wait a minute, then connect again.';
  }
  if (reasons.some((one) => one === 'insufficientPermissions' || one === 'PERMISSION_DENIED' || one === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return 'Google didn’t give Orbis permission to see your channel. Connect again and tick both YouTube permissions.';
  }
  if (reasons.some((one) => one === 'quotaExceeded' || one === 'RESOURCE_EXHAUSTED' || one === 'rateLimitExceeded')) {
    return 'YouTube’s daily API quota for this project is used up. Try again tomorrow.';
  }
  return `Google could not read your YouTube channel (error ${response.status}). Try again.`;
}

/** The person's own channel, or null when the Google account has none. */
export async function getChannel(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; title: string } | null> {
  const response = await fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new YouTubeAuthError(await channelRefusal(response));
  const payload = (await response.json().catch(() => ({}))) as { items?: { id?: unknown; snippet?: { title?: unknown } }[] };
  const channel = payload.items?.[0];
  if (!channel || typeof channel.id !== 'string' || !channel.id) return null;
  return { id: channel.id, title: typeof channel.snippet?.title === 'string' ? channel.snippet.title : '' };
}

/** Best effort: a token that is already gone, or an offline Google, must not block a disconnect. */
export async function revokeGoogleToken(token: string, fetchImpl: typeof fetch = fetch) {
  try {
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      cache: 'no-store',
    });
  } catch {
    // Nothing to do: the row is deleted either way.
  }
}
