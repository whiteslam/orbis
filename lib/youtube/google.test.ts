import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

import { exchangeYouTubeCode, getChannel, mintAccessToken, revokeGoogleToken, youtubeAuthUrl, YouTubeAuthError } from './google.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('youtubeAuthUrl asks for upload and readonly, offline, consent, with the callback under the site', () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  const url = new URL(youtubeAuthUrl('https://x.test', 'signed-state'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x.test/auth/youtube/callback');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('mintAccessToken throws a reconnect error on invalid_grant', async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const fake = (async () => json({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch;
  await assert.rejects(() => mintAccessToken('refresh', fake), (error: unknown) => error instanceof YouTubeAuthError && error.reconnect === true);
});

test('mintAccessToken throws a plain error on other failures, and returns the token on success', async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const down = (async () => json({ error: 'server_error' }, 500)) as unknown as typeof fetch;
  await assert.rejects(() => mintAccessToken('refresh', down), (error: unknown) => error instanceof YouTubeAuthError && error.reconnect === false);
  let seen: RequestInit | undefined;
  const ok = (async (_url: string, init?: RequestInit) => { seen = init; return json({ access_token: 'at', expires_in: 3600 }); }) as unknown as typeof fetch;
  assert.equal(await mintAccessToken('refresh', ok), 'at');
  assert.equal(seen?.cache, 'no-store');
  assert.match(String(seen?.body), /grant_type=refresh_token/);
});

test('exchangeYouTubeCode returns both tokens, and null when Google gives no refresh token', async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const scope = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
  let body = '';
  const withRefresh = (async (_url: string, init?: RequestInit) => { body = String(init?.body); return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope }); }) as unknown as typeof fetch;
  assert.deepEqual(await exchangeYouTubeCode('the-code', 'https://x.test', withRefresh), { accessToken: 'at', refreshToken: 'rt' });
  assert.equal(new URLSearchParams(body).get('redirect_uri'), 'https://x.test/auth/youtube/callback');
  const without = (async () => json({ access_token: 'at', expires_in: 3600, scope })) as unknown as typeof fetch;
  assert.deepEqual(await exchangeYouTubeCode('the-code', 'https://x.test', without), { accessToken: 'at', refreshToken: null });
});

test('exchangeYouTubeCode refuses a grant that left out uploading', async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const readOnly = (async () => json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.readonly' })) as unknown as typeof fetch;
  await assert.rejects(() => exchangeYouTubeCode('c', 'https://x.test', readOnly), /upload/i);
});

test('exchangeYouTubeCode refuses a grant that left out seeing the channel', async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const uploadOnly = (async () => json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload' })) as unknown as typeof fetch;
  await assert.rejects(() => exchangeYouTubeCode('c', 'https://x.test', uploadOnly), /allow access/i);
});

test('getChannel returns null when the account has no channel', async () => {
  const none = (async () => json({ items: [] })) as unknown as typeof fetch;
  assert.equal(await getChannel('at', none), null);
  const noItems = (async () => json({})) as unknown as typeof fetch;
  assert.equal(await getChannel('at', noItems), null);
  const one = (async () => json({ items: [{ id: 'UC1', snippet: { title: 'T' } }] })) as unknown as typeof fetch;
  assert.deepEqual(await getChannel('at', one), { id: 'UC1', title: 'T' });
});

test('getChannel sends the token as a bearer header and never caches', async () => {
  let seen: RequestInit | undefined;
  const fake = (async (_url: string, init?: RequestInit) => { seen = init; return json({ items: [] }); }) as unknown as typeof fetch;
  await getChannel('at', fake);
  assert.equal((seen?.headers as Record<string, string>).authorization, 'Bearer at');
  assert.equal(seen?.cache, 'no-store');
});

test('revokeGoogleToken never throws', async () => {
  const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  await assert.doesNotReject(() => revokeGoogleToken('rt', broken));
});
