import { test } from 'vitest';
import assert from 'node:assert/strict';
import { matchPosts, normalizeCaption, type PlannedPost } from './match.ts';
import type { LivePost } from './types.ts';

const CAPTION = 'Three things I learned building a personal finance app this summer, and why the boring parts mattered most.';
const planned = (extra: Partial<PlannedPost> = {}): PlannedPost => ({
  id: 'p1', platforms: ['instagram'], status: 'ready', plannedFor: '2026-09-20', period: '2026-09-01', caption: CAPTION, publishedOn: [], ...extra,
});
// 10:00 IST on the 21st.
const live = (extra: Partial<LivePost> = {}): LivePost => ({
  externalId: 'm1', caption: `${CAPTION} 🚀\n\n#buildinpublic #fintech`, permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-09-21T04:30:00+0000', productType: 'FEED', thumbnail: null, stats: null, ...extra,
});

test('captions are compared without case, hashtags, emoji, links or extra spaces', () => {
  assert.equal(normalizeCaption('  Hello   WORLD 🚀 #tag https://x.y/z  '), 'hello world');
});

test('a live post that starts with the planned caption matches, emoji and hashtags aside', () => {
  const pairs = matchPosts('instagram', [planned()], [live()]);
  assert.deepEqual(pairs.map((pair) => [pair.postId, pair.live.externalId]), [['p1', 'm1']]);
});

test('only the first 80 characters need to agree, so a caption edited near the end still matches', () => {
  assert.equal(matchPosts('instagram', [planned()], [live({ caption: `${CAPTION.slice(0, 85)} — edited ending` })]).length, 1);
});

test('outside three days of the planned day, no match', () => {
  assert.equal(matchPosts('instagram', [planned()], [live({ timestamp: '2026-09-24T04:30:00+0000' })]).length, 0, '4 days after');
  assert.equal(matchPosts('instagram', [planned()], [live({ timestamp: '2026-09-23T04:30:00+0000' })]).length, 1, '3 days after');
});

test('a post with no day matches anywhere in its month', () => {
  assert.equal(matchPosts('instagram', [planned({ plannedFor: null })], [live({ timestamp: '2026-09-02T04:30:00+0000' })]).length, 1);
  assert.equal(matchPosts('instagram', [planned({ plannedFor: null })], [live({ timestamp: '2026-10-01T04:30:00+0000' })]).length, 0);
});

test('short captions are too weak to match', () => {
  // 'hi everyone' is 11 characters once normalised: under the 12 needed.
  assert.equal(matchPosts('instagram', [planned({ caption: 'Hi everyone' })], [live({ caption: 'Hi everyone' })]).length, 0);
});

test('ambiguity in either direction marks nothing', () => {
  assert.equal(matchPosts('instagram', [planned(), planned({ id: 'p2' })], [live()]).length, 0, 'one live post, two planned');
  assert.equal(matchPosts('instagram', [planned()], [live(), live({ externalId: 'm2' })]).length, 0, 'one planned, two live');
});

test('only candidates for this platform that are not yet published there', () => {
  assert.equal(matchPosts('threads', [planned()], [live()]).length, 0, 'does not list threads');
  assert.equal(matchPosts('instagram', [planned({ publishedOn: ['instagram'] })], [live()]).length, 0);
  assert.equal(matchPosts('instagram', [planned({ status: 'draft' })], [live()]).length, 0);
  assert.equal(matchPosts('instagram', [planned({ status: 'published', publishedOn: ['threads'] })], [live()]).length, 1);
});

test('skin tones, flags, keycaps and Indic hashtags are ignored too', () => {
  assert.equal(normalizeCaption('Hello 👍🏽 world'), 'hello world');
  assert.equal(normalizeCaption('Proud 🇮🇳 moment'), 'proud moment');
  assert.equal(normalizeCaption('1️⃣ first'), '1 first');
  assert.equal(normalizeCaption('नमस्ते दुनिया #नमस्ते'), 'नमस्ते दुनिया');
});
