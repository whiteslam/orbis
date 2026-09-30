import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mayPush } from './push-rules.ts';

const now = new Date('2026-09-30T06:00:00Z');
const headsup = { urgency: 'urgent' as const, createdAt: '2026-09-30T01:00:00Z', pushedAt: null, snoozedUntil: null, status: 'new' };
const context = { pushesToday: 0, localMinutes: 11 * 60, notificationsEnabled: true, hasDevice: true };

test('an urgent, new heads-up pushes in the day', () => {
  assert.equal(mayPush(headsup, context, now), true);
});

test('only urgent ones push', () => {
  assert.equal(mayPush({ ...headsup, urgency: 'normal' }, context, now), false);
});

test('at most two a day', () => {
  assert.equal(mayPush(headsup, { ...context, pushesToday: 1 }, now), true);
  assert.equal(mayPush(headsup, { ...context, pushesToday: 2 }, now), false);
});

test('quiet from 22:00 until 07:00', () => {
  assert.equal(mayPush(headsup, { ...context, localMinutes: 7 * 60 - 1 }, now), false);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 7 * 60 }, now), true);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 22 * 60 - 1 }, now), true);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 22 * 60 }, now), false);
});

test('never twice, never when seen, snoozed, stale or unwanted', () => {
  assert.equal(mayPush({ ...headsup, pushedAt: '2026-09-30T02:00:00Z' }, context, now), false);
  assert.equal(mayPush({ ...headsup, status: 'seen' }, context, now), false);
  assert.equal(mayPush({ ...headsup, snoozedUntil: '2026-10-02T00:00:00Z' }, context, now), false);
  assert.equal(mayPush({ ...headsup, createdAt: '2026-09-29T05:59:00Z' }, context, now), false, 'over 24 hours old');
  assert.equal(mayPush(headsup, { ...context, notificationsEnabled: false }, now), false);
  assert.equal(mayPush(headsup, { ...context, hasDevice: false }, now), false);
});
