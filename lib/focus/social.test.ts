import { test } from 'vitest';
import assert from 'node:assert/strict';
import { composeSocialRow } from './social.ts';
import type { SocialPost } from '../social/types.ts';

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p', period: '2026-09-01', title: 'T', headline: null, caption: 'c', hashtags: [], format: 'post', platforms: [],
  plannedFor: '2026-09-28', status: 'draft', mediaPath: null, mediaType: null, mediaUrl: null, published: null,
  source: 'manual', position: 0, updatedAt: '', ...over,
});
const TODAY = '2026-09-28';

test('no row when the month has no posts', () => {
  assert.equal(composeSocialRow([], TODAY), null);
});

test('an empty row when nothing is planned today', () => {
  assert.deepEqual(composeSocialRow([post({ plannedFor: '2026-09-02' })], TODAY), { label: 'Social today', value: 'Nothing planned', empty: true, target: 'social' });
});

test('counts today and what is not ready yet', () => {
  const row = composeSocialRow([post(), post({ status: 'ready' }), post({ status: 'idea' })], TODAY);
  assert.equal(row?.value, '3 today, 2 not ready');
  assert.equal(row?.empty, false);
});

test('says when everything planned today is ready or out', () => {
  assert.equal(composeSocialRow([post({ status: 'ready' })], TODAY)?.value, '1 today, ready');
  assert.equal(composeSocialRow([post({ status: 'published', published: { at: 'x', platform: 'x', link: null } })], TODAY)?.value, '1 today, all out');
});
