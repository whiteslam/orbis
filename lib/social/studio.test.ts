import { test } from 'vitest';
import assert from 'node:assert/strict';
import { accountAllowed, groupPosts, postsFor, titleFromCaption } from './studio.ts';
import type { SocialPost } from './types.ts';

const p = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p', account: 'me', period: '2026-11-01', title: 'T', headline: null, caption: 'c', hashtags: [], format: 'post', platforms: [],
  plannedFor: null, status: 'draft', mediaPath: null, mediaType: null, mediaUrl: null, published: null, source: 'manual', position: 0,
  updatedAt: '2026-11-01T00:00:00Z', ...over,
});

test('only the owner may use the orbis account', () => {
  assert.equal(accountAllowed('orbis', 'owner'), true);
  assert.equal(accountAllowed('orbis', 'admin'), false);
  assert.equal(accountAllowed('orbis', 'user'), false);
  assert.equal(accountAllowed('me', 'user'), true);
});

test('title is the first non-empty caption line, cut to 120', () => {
  assert.equal(titleFromCaption('\n  Hello world  \nmore', null), 'Hello world');
  assert.equal(titleFromCaption('x'.repeat(200), null).length, 120);
});

test('a post with no words is named after its media', () => {
  assert.equal(titleFromCaption('   ', 'image'), 'Photo post');
  assert.equal(titleFromCaption('', 'video'), 'Video post');
  assert.equal(titleFromCaption('', null), 'Untitled post');
});

test('groupPosts sorts every post into exactly one group', () => {
  const g = groupPosts([
    p({ id: 'a', plannedFor: '2026-11-13', status: 'draft' }),
    p({ id: 'b', plannedFor: '2026-11-20', status: 'ready' }),
    p({ id: 'c', plannedFor: null, status: 'idea' }),
    p({ id: 'd', plannedFor: '2026-11-02', status: 'ready' }),
    p({ id: 'e', plannedFor: '2026-11-02', status: 'published', published: { at: '2026-11-02T10:00:00Z', platform: 'instagram', link: null } }),
  ], '2026-11-13');
  assert.deepEqual(g.comingUp.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(g.noDate.map((x) => x.id), ['c']);
  assert.deepEqual(g.pastNotPosted.map((x) => x.id), ['d']);
  assert.deepEqual(g.posted.map((x) => x.id), ['e']);
});

test('comingUp is in day order then position; posted is newest first', () => {
  const g = groupPosts([
    p({ id: 'late', plannedFor: '2026-11-20', position: 0 }),
    p({ id: 'second', plannedFor: '2026-11-14', position: 2 }),
    p({ id: 'first', plannedFor: '2026-11-14', position: 1 }),
    p({ id: 'old', status: 'published', published: { at: '2026-11-01T10:00:00Z', platform: 'x', link: null } }),
    p({ id: 'new', status: 'published', published: { at: '2026-11-10T10:00:00Z', platform: 'x', link: null } }),
  ], '2026-11-13');
  assert.deepEqual(g.comingUp.map((x) => x.id), ['first', 'second', 'late']);
  assert.deepEqual(g.posted.map((x) => x.id), ['new', 'old']);
});

test('postsFor keeps one account', () => {
  const posts = [p({ id: 'm' }), p({ id: 'o', account: 'orbis' })];
  assert.deepEqual(postsFor(posts, 'me').map((x) => x.id), ['m']);
  assert.deepEqual(postsFor(posts, 'orbis').map((x) => x.id), ['o']);
});
