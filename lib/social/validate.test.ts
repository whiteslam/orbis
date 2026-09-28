import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHashtags, cleanPlatforms, cleanPostInput, cleanPublish } from './validate.ts';

const input = (over: Record<string, unknown> = {}) => ({
  period: '2026-09-01', title: 'Launch', headline: '', caption: 'Hello', hashtags: [], format: 'post', platforms: ['instagram'], plannedFor: '2026-09-14', ...over,
});

test('cleanHashtags strips #, spaces and duplicates, and caps count and length', () => {
  assert.deepEqual(cleanHashtags(['#Travel', 'travel', ' food ', '', '#', 'two words']), ['Travel', 'food', 'twowords']);
  assert.equal(cleanHashtags(Array.from({ length: 40 }, (_, index) => `t${index}`)).length, 30);
  assert.equal(cleanHashtags(['x'.repeat(80)])[0].length, 50);
  assert.deepEqual(cleanHashtags('nope'), []);
});

test('cleanPlatforms keeps only known platforms, once each', () => {
  assert.deepEqual(cleanPlatforms(['x', 'myspace', 'x', 'instagram']), ['x', 'instagram']);
  assert.deepEqual(cleanPlatforms(null), []);
});

test('cleanPostInput accepts a complete post and trims it', () => {
  const result = cleanPostInput(input({ title: '  Launch  ', headline: '  ' }));
  assert.ok(result.ok);
  assert.equal(result.value.title, 'Launch');
  assert.equal(result.value.headline, null);
  assert.equal(result.value.plannedFor, '2026-09-14');
});

test('cleanPostInput caps long fields rather than rejecting them', () => {
  const result = cleanPostInput(input({ title: 't'.repeat(300), headline: 'h'.repeat(300), caption: 'c'.repeat(6000) }));
  assert.ok(result.ok);
  assert.equal(result.value.title.length, 120);
  assert.equal(result.value.headline?.length, 200);
  assert.equal(result.value.caption.length, 5000);
});

test('cleanPostInput rejects a bad period, a blank title and an unknown format', () => {
  assert.deepEqual(cleanPostInput(input({ period: '2026-09-02' })), { ok: false, message: 'That month is invalid.' });
  assert.deepEqual(cleanPostInput(input({ title: '   ' })), { ok: false, message: 'Give the post a title.' });
  assert.deepEqual(cleanPostInput(input({ format: 'carousel' })), { ok: false, message: 'Choose post, reel or story.' });
  assert.deepEqual(cleanPostInput(null), { ok: false, message: 'Enter the post details.' });
});

test('cleanPostInput wants the day inside the month, and a real day', () => {
  assert.deepEqual(cleanPostInput(input({ plannedFor: '2026-10-01' })), { ok: false, message: 'Pick a day inside September.' });
  assert.deepEqual(cleanPostInput(input({ plannedFor: '2026-09-31' })), { ok: false, message: 'Pick a day inside September.' });
  const undated = cleanPostInput(input({ plannedFor: null }));
  assert.ok(undated.ok && undated.value.plannedFor === null);
});

test('cleanPublish needs a known place and an https link when one is given', () => {
  assert.deepEqual(cleanPublish({ platform: 'instagram', link: '' }), { ok: true, value: { platform: 'instagram', link: null } });
  assert.deepEqual(cleanPublish({ platform: 'other', link: ' https://example.com/p/1 ' }), { ok: true, value: { platform: 'other', link: 'https://example.com/p/1' } });
  assert.deepEqual(cleanPublish({ platform: 'myspace' }), { ok: false, message: 'Choose where it went out.' });
  assert.deepEqual(cleanPublish({ platform: 'x', link: 'http://example.com' }), { ok: false, message: 'Paste the full link, starting with https://' });
  assert.deepEqual(cleanPublish({ platform: 'x', link: 'javascript:alert(1)' }), { ok: false, message: 'Paste the full link, starting with https://' });
});
