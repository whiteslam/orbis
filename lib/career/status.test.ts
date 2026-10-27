import { test } from 'vitest';
import assert from 'node:assert/strict';
import { APPLICATION_STATUSES } from './types.ts';
import { STAGE_GROUPS, canTransition, groupOf, isOpen, isWatched, isWatchedNow, ownerMoves, stageRank, statusFromReply } from './status.ts';

test('every status sits in exactly one column', () => {
  for (const status of APPLICATION_STATUSES) {
    assert.equal(STAGE_GROUPS.filter((group) => group.statuses.includes(status)).length, 1, status);
  }
  assert.equal(groupOf('assessment'), 'replied');
  assert.equal(groupOf('ghosted'), 'closed');
  assert.equal(groupOf('opened'), 'ready');
});

test('the ladder runs sent to offer', () => {
  assert.ok(stageRank('sent') < stageRank('acknowledged'));
  assert.ok(stageRank('interview') < stageRank('offer'));
  assert.equal(stageRank('drafting'), -1);
  assert.ok(isOpen('interview'));
  assert.ok(!isOpen('ghosted'));
  assert.ok(isWatched('ghosted'));
  assert.ok(!isOpen('ready'));
});

test('mail only moves forward', () => {
  assert.ok(canTransition('sent', 'interview', 'mail'));
  assert.ok(canTransition('acknowledged', 'replied', 'mail'));
  assert.ok(!canTransition('interview', 'replied', 'mail'));
  assert.ok(!canTransition('interview', 'acknowledged', 'mail'));
  assert.ok(!canTransition('ready', 'replied', 'mail'));
  assert.ok(!canTransition('offer', 'offer', 'mail'));
});

test('mail may reject anything before an offer, never after', () => {
  assert.ok(canTransition('sent', 'rejected', 'mail'));
  assert.ok(canTransition('interview', 'rejected', 'mail'));
  assert.ok(!canTransition('offer', 'rejected', 'mail'));
  assert.ok(!canTransition('accepted', 'rejected', 'mail'));
});

test('withdrawn, accepted and declined are the owner\'s alone', () => {
  for (const by of ['mail', 'system'] as const) {
    assert.ok(!canTransition('offer', 'accepted', by));
    assert.ok(!canTransition('offer', 'declined', by));
    assert.ok(!canTransition('sent', 'withdrawn', by));
  }
  assert.ok(canTransition('offer', 'accepted', 'owner'));
  assert.ok(canTransition('offer', 'declined', 'owner'));
  assert.ok(!canTransition('interview', 'accepted', 'owner'));
  assert.ok(canTransition('interview', 'withdrawn', 'owner'));
});

test('only the system ghosts, and only without a reply', () => {
  assert.ok(canTransition('sent', 'ghosted', 'system'));
  assert.ok(canTransition('acknowledged', 'ghosted', 'system'));
  assert.ok(!canTransition('interview', 'ghosted', 'system'));
  assert.ok(!canTransition('sent', 'ghosted', 'owner'));
  assert.ok(!canTransition('sent', 'ghosted', 'mail'));
});

test('a reply revives a ghosted application', () => {
  assert.ok(canTransition('ghosted', 'interview', 'mail'));
  assert.ok(canTransition('ghosted', 'rejected', 'mail'));
  assert.ok(!canTransition('ghosted', 'sent', 'mail'));
  assert.equal(statusFromReply('ghosted', 'recruiter_question'), 'replied');
});

test('statusFromReply maps kinds and refuses backward moves', () => {
  assert.equal(statusFromReply('sent', 'acknowledgement'), 'acknowledged');
  assert.equal(statusFromReply('sent', 'interview_invite'), 'interview');
  assert.equal(statusFromReply('replied', 'assessment'), 'assessment');
  assert.equal(statusFromReply('acknowledged', 'offer'), 'offer');
  assert.equal(statusFromReply('interview', 'rejection'), 'rejected');
  assert.equal(statusFromReply('interview', 'acknowledgement'), null);
  assert.equal(statusFromReply('offer', 'rejection'), null);
  assert.equal(statusFromReply('sent', 'other'), null);
  assert.equal(statusFromReply('withdrawn', 'offer'), null);
});

test('the owner\'s menu', () => {
  assert.deepEqual(ownerMoves('opened'), ['ready', 'sent', 'withdrawn']);
  // A rescinded offer is the owner's to record.
  assert.deepEqual(ownerMoves('offer'), ['accepted', 'declined', 'rejected', 'withdrawn']);
  assert.ok(ownerMoves('sent').includes('interview'));
  assert.ok(!ownerMoves('sent').includes('ghosted'));
  assert.ok(!ownerMoves('interview').includes('replied'));
  assert.deepEqual(ownerMoves('accepted'), []);
  assert.deepEqual(ownerMoves('sending'), []);
  // Correcting a misread rejection.
  assert.ok(ownerMoves('rejected').includes('interview'));
});

test('a rejected application stays watched for 30 days after its last news', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const rejected = (lastEventAt: string | null) => ({ status: 'rejected' as const, lastEventAt, updatedAt: '2026-01-01T00:00:00Z' });
  assert.ok(isWatchedNow(rejected('2026-10-10T00:00:00Z'), now));
  assert.ok(!isWatchedNow(rejected('2026-09-20T00:00:00Z'), now));
  assert.ok(!isWatchedNow(rejected(null), now));
  assert.ok(isWatchedNow({ status: 'ghosted', lastEventAt: null, updatedAt: '2025-01-01T00:00:00Z' }, now));
  assert.ok(!isWatchedNow({ status: 'withdrawn', lastEventAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z' }, now));
});
