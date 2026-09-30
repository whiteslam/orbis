import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dueForScan, localNow, mergeAction, pruneBefore, runChecks } from './plan.ts';
import type { Finding } from './types.ts';

// 00:30 UTC = 06:00 IST.
const at = (iso: string) => new Date(iso);

test('a person is due once a day, from 06:00 their time', () => {
  const people = [{ userId: 'a', timeZone: 'Asia/Kolkata', lastScanDate: '2026-09-29' }];
  assert.deepEqual(dueForScan(people, at('2026-09-30T00:29:00Z')), [], '05:59 IST');
  assert.deepEqual(dueForScan(people, at('2026-09-30T00:30:00Z')), [{ userId: 'a', localDate: '2026-09-30', timeZone: 'Asia/Kolkata' }]);
  assert.deepEqual(dueForScan([{ ...people[0], lastScanDate: '2026-09-30' }], at('2026-09-30T05:00:00Z')), [], 'already scanned today');
  assert.equal(dueForScan([{ ...people[0], lastScanDate: null }], at('2026-09-30T05:00:00Z')).length, 1, 'never scanned');
});

test('a bad timezone falls back to India time', () => {
  assert.equal(localNow(at('2026-09-30T00:30:00Z'), 'Not/AZone').minutes, 6 * 60);
});

test('what a finding does to the row already there', () => {
  const now = at('2026-09-30T06:00:00Z');
  assert.equal(mergeAction(null, now), 'insert');
  assert.equal(mergeAction({ status: 'new', updatedAt: '2026-09-29T06:00:00Z' }, now), 'refresh');
  assert.equal(mergeAction({ status: 'seen', updatedAt: '2026-09-29T06:00:00Z' }, now), 'refresh');
  assert.equal(mergeAction({ status: 'done', updatedAt: '2026-01-01T00:00:00Z' }, now), 'skip', 'done is final');
  assert.equal(mergeAction({ status: 'dismissed', updatedAt: '2026-09-01T06:00:01Z' }, now), 'skip', 'inside 30 days');
  assert.equal(mergeAction({ status: 'dismissed', updatedAt: '2026-08-31T06:00:00Z' }, now), 'revive', '30 days on');
});

const finding = (kind: Finding['kind']): Finding => ({
  kind, dedupeKey: kind, urgency: 'normal', evidence: {}, action: { type: 'open_steps' }, fallback: { title: 't', body: 'b', actionLabel: 'a' },
});

test('one check throwing does not stop the rest, and disabled kinds never run', () => {
  let ranDisabled = false;
  const result = runChecks([
    { kind: 'money.big_spend', run: () => { throw new Error('bad data'); } },
    { kind: 'health.steps_down', run: () => [finding('health.steps_down')] },
    { kind: 'routine.slipping', run: () => { ranDisabled = true; return [finding('routine.slipping')]; } },
  ], ['routine.slipping']);
  assert.deepEqual(result.findings.map((item) => item.kind), ['health.steps_down']);
  assert.deepEqual(result.failed, ['money.big_spend']);
  assert.equal(ranDisabled, false);
});

test('rows older than 60 days are pruned', () => {
  assert.equal(pruneBefore(at('2026-09-30T06:00:00Z')), '2026-08-01T06:00:00.000Z');
});
