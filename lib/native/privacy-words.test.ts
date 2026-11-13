import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SOURCES } from '@/lib/device/sources';
import { activityWords, addToList, blockedFirst, isSource, lastSeenWords, pauseState, SOURCE_LABELS, toggleBlocked } from './privacy-words';

test('every wire name has a plain label, and only wire names are sources', () => {
  for (const source of SOURCES) assert.ok(SOURCE_LABELS[source].length > 0, source);
  assert.equal(SOURCE_LABELS.test, 'Test source');
  assert.equal(isSource('phone_state'), true);
  assert.equal(isSource('Test'), false);
  assert.equal(isSource('toString'), false);
  assert.equal(isSource(null), false);
});

test('a ledger entry reads as source, kept or dropped, and the reason in plain words', () => {
  assert.deepEqual(activityWords({ at: 1, source: 'test', decision: 'kept' }), { source: 'Test source', decision: 'Kept', reason: null });
  assert.deepEqual(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'BLOCKED_APP' }), { source: 'Test source', decision: 'Dropped', reason: 'From a blocked app' });
  assert.equal(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'BLOCKED_CONTACT' }).reason, 'From a blocked contact');
  assert.equal(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'BLOCKED_KEYWORD' }).reason, 'Had a blocked word');
  assert.equal(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'PAUSED' }).reason, 'Orbis was paused');
  assert.equal(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'SOURCE_OFF' }).reason, 'The source was off');
  assert.equal(activityWords({ at: 1, source: 'test', decision: 'dropped', reason: 'OTHER_PROFILE' }).reason, 'From a work or private profile');
});

test('an unknown reason or source never shows its raw code', () => {
  const words = activityWords({ at: 1, source: 'weird', decision: 'dropped', reason: 'SOMETHING_NEW' });
  assert.deepEqual(words, { source: 'Other', decision: 'Dropped', reason: 'Left out by a rule' });
  assert.equal(activityWords({ at: 1, source: 'calls', decision: 'dropped' }).reason, 'Left out by a rule');
});

test('pause state: off, until a time, or until turned back on', () => {
  const now = 1_000_000;
  assert.deepEqual(pauseState(null, now), { kind: 'off' });
  assert.deepEqual(pauseState(-1, now), { kind: 'forever' });
  assert.deepEqual(pauseState(now + 60_000, now), { kind: 'until', at: now + 60_000 });
  assert.deepEqual(pauseState(now - 1, now), { kind: 'off' }, 'a pause that has run out is off');
});

test('adding to a blocked list trims, skips blanks and repeats, and refuses what the phone would refuse', () => {
  assert.deepEqual(addToList(['salary'], '  bonus '), ['salary', 'bonus']);
  assert.deepEqual(addToList(['salary'], 'SALARY'), ['salary']);
  assert.deepEqual(addToList(['salary'], '   '), ['salary']);
  assert.deepEqual(addToList([], 'x'.repeat(201)), []);
  const full = Array.from({ length: 500 }, (_, i) => `w${i}`);
  assert.deepEqual(addToList(full, 'one more'), full);
});

test('ticking an app keeps blocked packages that are not installed', () => {
  const blocked = ['com.authy.authy', 'com.sbi.lotusintouch'];
  assert.deepEqual(toggleBlocked(blocked, 'com.whatsapp', true), ['com.authy.authy', 'com.sbi.lotusintouch', 'com.whatsapp']);
  assert.deepEqual(toggleBlocked(blocked, 'com.authy.authy', false), ['com.sbi.lotusintouch']);
  assert.deepEqual(toggleBlocked(blocked, 'com.authy.authy', true), blocked);
});

test('blocked apps are listed first, then by name', () => {
  const apps = [{ packageName: 'b', label: 'Bank' }, { packageName: 'a', label: 'Authy' }, { packageName: 'c', label: 'Camera' }];
  assert.deepEqual(blockedFirst(apps, ['b']).map((app) => app.label), ['Bank', 'Authy', 'Camera']);
});

test('last seen in plain words', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(lastSeenWords(null, now), 'Not synced yet');
  assert.equal(lastSeenWords('2026-11-13T11:59:30Z', now), 'Just now');
  assert.equal(lastSeenWords('2026-11-13T11:59:30Z', now - 60_000), 'Just now', 'a clock a little behind is still just now');
  assert.equal(lastSeenWords('2026-11-13T11:55:00Z', now), '5 minutes ago');
  assert.equal(lastSeenWords('2026-11-13T11:00:00Z', now), '1 hour ago');
  assert.equal(lastSeenWords('2026-11-13T07:00:00Z', now), '5 hours ago');
  assert.equal(lastSeenWords('2026-11-12T08:00:00Z', now), 'Yesterday');
  assert.equal(lastSeenWords('2026-11-03T12:00:00Z', now), '10 days ago');
  assert.equal(lastSeenWords('not a date', now), 'Not synced yet');
});
