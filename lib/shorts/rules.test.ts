import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canApprove, canCancel, canRetry, cleanTopic, isActive, limitRefusal, LIMITS, mergeEvents, monthStartIst, readOptions, workerPresence } from './rules';
import type { ShortEvent, ShortJob, WorkerState } from './types';

const STYLE = { secondsMin: 25, secondsMax: 45, defaultVoice: 'am_michael' };
const NOW = new Date('2026-11-10T08:00:00Z');

const job = (status: ShortJob['status']): ShortJob => ({
  id: '00000000-0000-4000-8000-000000000001', style: 'inside-out', topic: 'gum', status, stage: 'plan',
  options: { seconds: 30, voice: 'am_michael', mode: 'voice', music: 'bed', endLine: '' },
  plan: null, planFeedback: null, delivery: null, error: null, attempt: 1,
  createdAt: NOW.toISOString(), startedAt: null, finishedAt: null, lastEventAt: null,
});

test('a topic is trimmed, cleaned of control characters and capped', () => {
  assert.equal(cleanTopic('  what if you\u0007 swallow   gum  '), 'what if you swallow gum');
  assert.equal(cleanTopic('   '), null);
  assert.equal(cleanTopic(42), null);
  assert.equal(cleanTopic('a'.repeat(LIMITS.topic + 1)), null);
  assert.equal(cleanTopic('a'.repeat(LIMITS.topic))?.length, LIMITS.topic);
});

test('options fall back to safe values and stay inside the style’s range', () => {
  assert.deepEqual(readOptions({}, STYLE), { seconds: 35, voice: 'am_michael', mode: 'voice', music: 'bed', endLine: '' });
  const odd = readOptions({ seconds: 90, voice: 'rm -rf', mode: 'shout', music: 'none', endLine: `@me ${'x'.repeat(100)}` }, STYLE);
  assert.equal(odd?.seconds, 45);
  assert.equal(odd?.voice, 'am_michael');
  assert.equal(odd?.mode, 'voice');
  assert.equal(odd?.music, 'none');
  assert.equal(odd?.endLine.length, LIMITS.endLine);
  assert.equal(readOptions({ seconds: 10, voice: 'af_heart', mode: 'captions' }, STYLE)?.seconds, 25);
  assert.equal(readOptions({ voice: 'af_heart', mode: 'captions' }, STYLE)?.voice, 'af_heart');
  assert.equal(readOptions(null, STYLE), null);
});

test('the worker is offline when it hasn’t been seen for two minutes', () => {
  const seen = (secondsAgo: number, state: WorkerState['state'] = 'idle'): WorkerState => ({ lastSeen: new Date(NOW.getTime() - secondsAgo * 1000).toISOString(), state, note: null, voices: [] });
  assert.equal(workerPresence(null, NOW), 'none');
  assert.equal(workerPresence(seen(180), NOW), 'offline');
  assert.equal(workerPresence(seen(10, 'busy'), NOW), 'busy');
  assert.equal(workerPresence(seen(10, 'setup'), NOW), 'setup');
  assert.equal(workerPresence({ ...seen(10), lastSeen: null }, NOW), 'offline');
});

test('each action is allowed only from its own statuses', () => {
  assert.equal(canApprove(job('plan_ready')), true);
  assert.equal(canApprove(job('planning')), false);
  assert.equal(canCancel(job('building')), true);
  assert.equal(canCancel(job('done')), false);
  assert.equal(canRetry(job('failed')), true);
  assert.equal(canRetry(job('cancelled')), false);
  assert.equal(isActive(job('queued')), true);
  assert.equal(isActive(job('plan_ready')), false);
});

test('the queue limits', () => {
  assert.match(limitRefusal(3, 0) ?? '', /3 shorts/);
  assert.match(limitRefusal(0, 30) ?? '', /30 shorts this month/);
  assert.equal(limitRefusal(2, 29), null);
});

test('the month starts at midnight in India', () => {
  assert.equal(monthStartIst(new Date('2026-11-10T08:00:00Z')), '2026-10-31T18:30:00.000Z');
  // 20:00 UTC on Nov 30 is already Dec 1 in India.
  assert.equal(monthStartIst(new Date('2026-11-30T20:00:00Z')), '2026-11-30T18:30:00.000Z');
});

test('events merge by seq, once each, in order', () => {
  const event = (seq: number): ShortEvent => ({ seq, kind: 'step', content: `s${seq}`, at: NOW.toISOString() });
  assert.deepEqual(mergeEvents([event(1), event(2)], [event(2), event(4), event(3)]).map((item) => item.seq), [1, 2, 3, 4]);
});
