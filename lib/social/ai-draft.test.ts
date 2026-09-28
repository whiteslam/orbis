import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftPrompt, draftMaxTokens, parseAiDraft } from './ai-draft.ts';

const options = { period: '2026-09-01', count: 3, formats: ['post', 'reel'] as const };
const json = (posts: unknown[]) => JSON.stringify({ posts });
const item = (over: Record<string, unknown> = {}) => ({ title: 'Tip', headline: 'Head', caption: 'A caption', hashtags: ['#one', 'two'], format: 'post', day: 5, ...over });

test('parseAiDraft returns nothing for junk', () => {
  assert.deepEqual(parseAiDraft('not json', { ...options, formats: [...options.formats] }), []);
  assert.deepEqual(parseAiDraft('{"posts": "no"}', { ...options, formats: [...options.formats] }), []);
  assert.deepEqual(parseAiDraft('', { ...options, formats: [...options.formats] }), []);
});

test('parseAiDraft reads a fenced reply and turns day into a date', () => {
  const [post] = parseAiDraft('```json\n' + json([item()]) + '\n```', { ...options, formats: [...options.formats] });
  assert.equal(post.plannedFor, '2026-09-05');
  assert.deepEqual(post.hashtags, ['one', 'two']);
  assert.equal(post.format, 'post');
  assert.equal(post.period, '2026-09-01');
});

test('parseAiDraft keeps at most count posts', () => {
  const posts = parseAiDraft(json(Array.from({ length: 40 }, (_, index) => item({ title: `T${index}` }))), { ...options, formats: [...options.formats] });
  assert.equal(posts.length, 3);
});

test('parseAiDraft drops posts without a caption', () => {
  const posts = parseAiDraft(json([item({ caption: '' }), item({ caption: 42 }), item()]), { ...options, formats: [...options.formats] });
  assert.equal(posts.length, 1);
});

test('parseAiDraft leaves a day outside the month undated', () => {
  const posts = parseAiDraft(json([item({ day: 31 }), item({ day: 0 }), item({ day: '2026-10-03' }), item({ day: 2.5 })]), { ...options, count: 4, formats: [...options.formats] });
  assert.deepEqual(posts.map((post) => post.plannedFor), [null, null, null, null]);
});

test('parseAiDraft clamps long fields', () => {
  const [post] = parseAiDraft(json([item({ title: 't'.repeat(500), headline: 'h'.repeat(500), caption: 'c'.repeat(10_000), hashtags: Array.from({ length: 60 }, (_, index) => `tag${index}`) })]), { ...options, formats: [...options.formats] });
  assert.equal(post.title.length, 120);
  assert.equal(post.headline?.length, 200);
  assert.equal(post.caption.length, 5000);
  assert.equal(post.hashtags.length, 30);
});

test('parseAiDraft replaces a format that was not asked for with the first one that was', () => {
  const posts = parseAiDraft(json([item({ format: 'story' }), item({ format: 'carousel' }), item({ format: 'reel' })]), { ...options, formats: ['reel'] });
  assert.deepEqual(posts.map((post) => post.format), ['reel', 'reel', 'reel']);
});

test('parseAiDraft titles an untitled post from its caption', () => {
  const [post] = parseAiDraft(json([item({ title: '', caption: 'First line here\nsecond' })]), { ...options, formats: [...options.formats] });
  assert.equal(post.title, 'First line here');
});

test('draftMaxTokens grows with the number of posts so a full month is not cut off', () => {
  assert.ok(draftMaxTokens(1) >= 1000);
  assert.ok(draftMaxTokens(15) >= 15 * 400);
  assert.ok(draftMaxTokens(15) > draftMaxTokens(5));
  assert.ok(draftMaxTokens(15) <= 8000);
});

test('buildDraftPrompt states the count, the month length and the strictest limit', () => {
  const prompt = buildDraftPrompt({ period: '2026-09-01', brief: 'Autumn menu', count: 4, formats: ['post'], platforms: ['instagram', 'x'], tone: 'friendly', profile: null });
  assert.match(prompt.system, /Exactly 4 posts/);
  assert.match(prompt.system, /\(1-30\)/);
  assert.match(prompt.system, /280 characters/);
  assert.match(prompt.user, /September 2026/);
  assert.match(prompt.user, /Autumn menu/);
  assert.doesNotMatch(prompt.user, /About me/);
});

test('buildDraftPrompt includes the profile only when given one', () => {
  const prompt = buildDraftPrompt({ period: '2026-09-01', brief: 'x', count: 1, formats: ['post'], platforms: [], tone: 'playful', profile: { preferredName: 'Sam', role: 'Chef', aboutMe: 'Runs a cafe' } });
  assert.match(prompt.user, /Runs a cafe/);
  assert.match(prompt.system, /Emojis are fine/);
});
