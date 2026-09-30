import { test } from 'vitest';
import assert from 'node:assert/strict';
import { authorizeUrl, codeExchange, containerStatus, createContainer, longLivedExchange, me, mediaInsights, monthMedia, publishContainer, refreshToken } from './requests.ts';

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

test('authorize URLs carry the scopes, state and redirect', () => {
  const ig = new URL(authorizeUrl('instagram', { clientId: '123', redirectUri: 'https://x.test/auth/meta/instagram/callback', state: 's1' }));
  assert.equal(`${ig.origin}${ig.pathname}`, 'https://www.instagram.com/oauth/authorize');
  assert.deepEqual(params(ig.toString()), {
    client_id: '123', redirect_uri: 'https://x.test/auth/meta/instagram/callback', response_type: 'code', state: 's1',
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
  });
  const th = new URL(authorizeUrl('threads', { clientId: '9', redirectUri: 'https://x.test/auth/meta/threads/callback', state: 's2' }));
  assert.equal(`${th.origin}${th.pathname}`, 'https://threads.com/oauth/authorize');
  assert.equal(th.searchParams.get('scope'), 'threads_basic,threads_content_publish,threads_manage_insights');
});

test('the code exchange is a form POST to each platform’s token endpoint', () => {
  const ig = codeExchange('instagram', { clientId: '1', clientSecret: 'sec', redirectUri: 'https://x.test/cb', code: 'abc' });
  assert.equal(ig.method, 'POST');
  assert.equal(ig.url, 'https://api.instagram.com/oauth/access_token');
  assert.deepEqual(Object.fromEntries(ig.body!), { client_id: '1', client_secret: 'sec', grant_type: 'authorization_code', redirect_uri: 'https://x.test/cb', code: 'abc' });
  assert.equal(codeExchange('threads', { clientId: '1', clientSecret: 's', redirectUri: 'r', code: 'c' }).url, 'https://graph.threads.com/oauth/access_token');
});

test('long-lived exchange and refresh use each platform’s grant type', () => {
  assert.deepEqual(params(longLivedExchange('instagram', { clientSecret: 'sec', token: 't' }).url), { grant_type: 'ig_exchange_token', client_secret: 'sec', access_token: 't' });
  assert.ok(longLivedExchange('threads', { clientSecret: 's', token: 't' }).url.startsWith('https://graph.threads.com/access_token?'));
  assert.equal(new URL(refreshToken('instagram', 't').url).searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(new URL(refreshToken('threads', 't').url).pathname, '/refresh_access_token');
  assert.equal(new URL(refreshToken('threads', 't').url).searchParams.get('grant_type'), 'th_refresh_token');
});

test('me asks Instagram for user_id (the account id) and Threads for id', () => {
  assert.equal(new URL(me('instagram', 't').url).searchParams.get('fields'), 'user_id,username');
  assert.equal(new URL(me('instagram', 't').url).pathname, '/v25.0/me');
  assert.equal(new URL(me('threads', 't').url).searchParams.get('fields'), 'id,username');
  assert.equal(new URL(me('threads', 't').url).host, 'graph.threads.com');
});

test('a month of media is asked for by Unix time', () => {
  const url = new URL(monthMedia('instagram', '178', 't', { since: 1_788_192_000, until: 1_790_784_000 }).url);
  assert.equal(url.pathname, '/v25.0/178/media');
  assert.equal(url.searchParams.get('since'), '1788192000');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.match(url.searchParams.get('fields')!, /media_product_type/);
  assert.equal(new URL(monthMedia('threads', '55', 't', { since: 1, until: 2 }).url).pathname, '/v1.0/55/threads');
});

test('insight metrics depend on the platform and the media type', () => {
  const metric = (url: string) => new URL(url).searchParams.get('metric');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'FEED').url), 'reach,views,likes,comments,saved,shares');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'REELS').url), 'reach,views,likes,comments,saved,shares');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'STORY').url), 'reach,views,shares,replies');
  assert.equal(metric(mediaInsights('threads', 'm', 't').url), 'views,likes,replies,reposts,quotes,shares');
});

test('containers: Instagram image, reel and story; Threads text and image', () => {
  const body = (request: { body?: URLSearchParams }) => Object.fromEntries(request.body!);
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'image', mediaUrl: 'https://m/a.jpg', text: 'hi' })), { image_url: 'https://m/a.jpg', caption: 'hi', access_token: 't' });
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'video', mediaUrl: 'https://m/a.mp4', text: 'hi' })), { media_type: 'REELS', video_url: 'https://m/a.mp4', caption: 'hi', share_to_feed: 'true', access_token: 't' });
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'story_image', mediaUrl: 'https://m/a.jpg', text: 'hi' })), { media_type: 'STORIES', image_url: 'https://m/a.jpg', access_token: 't' });
  assert.equal(createContainer('instagram', '178', 't', { kind: 'image', mediaUrl: 'u', text: '' }).url, 'https://graph.instagram.com/v25.0/178/media');
  assert.deepEqual(body(createContainer('threads', '55', 't', { kind: 'text', text: 'hello' })), { media_type: 'TEXT', text: 'hello', access_token: 't' });
  assert.deepEqual(body(createContainer('threads', '55', 't', { kind: 'image', mediaUrl: 'https://m/a.png', text: 'x' })), { media_type: 'IMAGE', image_url: 'https://m/a.png', text: 'x', access_token: 't' });
  assert.equal(createContainer('threads', '55', 't', { kind: 'text', text: 'x' }).url, 'https://graph.threads.com/v1.0/55/threads');
});

test('status and publish', () => {
  assert.equal(new URL(containerStatus('instagram', 'c1', 't').url).searchParams.get('fields'), 'status_code');
  assert.equal(new URL(containerStatus('threads', 'c1', 't').url).searchParams.get('fields'), 'status,error_message');
  const ig = publishContainer('instagram', '178', 't', 'c1');
  assert.equal(ig.url, 'https://graph.instagram.com/v25.0/178/media_publish');
  assert.deepEqual(Object.fromEntries(ig.body!), { creation_id: 'c1', access_token: 't' });
  assert.equal(publishContainer('threads', '55', 't', 'c1').url, 'https://graph.threads.com/v1.0/55/threads_publish');
});
