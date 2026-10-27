import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshnessDays, isResolved, missingMust, outcomesOf, reachedInterview } from './history.ts';
import type { CareerApplication, CareerJob, Match } from './types.ts';

const spec = { salaryFloor: null, salaryTarget: null, seniority: [] };
const job = (id: string): Pick<CareerJob, 'score' | 'postedAt' | 'thin' | 'salary' | 'requirements'> & { id: string } =>
  ({ id, score: 70, postedAt: '2026-10-01', thin: false, salary: null, requirements: null });
type App = Pick<CareerApplication, 'id' | 'jobId' | 'status' | 'sentAt' | 'route'>;
const app = (id: string, status: App['status'], sentAt: string | null = '2026-10-03'): App => ({ id, jobId: `j-${id}`, status, sentAt, route: 'email' });

test('interviews include offers and the decisions after them', () => {
  assert.equal(reachedInterview('interview'), true);
  assert.equal(reachedInterview('offer'), true);
  assert.equal(reachedInterview('declined'), true);
  assert.equal(reachedInterview('replied'), false);
  assert.equal(reachedInterview('rejected'), false);
});

test('only sent applications with an answer or long silence are resolved', () => {
  assert.equal(isResolved({ status: 'rejected', sentAt: '2026-10-01' }), true);
  assert.equal(isResolved({ status: 'ghosted', sentAt: '2026-10-01' }), true);
  assert.equal(isResolved({ status: 'sent', sentAt: '2026-10-01' }), false);
  assert.equal(isResolved({ status: 'acknowledged', sentAt: '2026-10-01' }), false);
  assert.equal(isResolved({ status: 'rejected', sentAt: null }), false);
});

test('freshness is whole days from posting to sending, never negative', () => {
  assert.equal(freshnessDays('2026-10-01T10:00:00Z', '2026-10-03T09:00:00Z'), 2);
  assert.equal(freshnessDays('2026-10-05', '2026-10-03'), 0);
  assert.equal(freshnessDays(null, '2026-10-03'), null);
});

test('outcomes come from resolved applications with a known job', () => {
  const jobs = new Map([['j-a', job('j-a')], ['j-b', job('j-b')], ['j-c', job('j-c')]]);
  const outcomes = outcomesOf([app('a', 'interview'), app('b', 'rejected'), app('c', 'sent'), app('d', 'ghosted')], jobs, spec, new Set(['b']));
  assert.deepEqual(outcomes.map((row) => [row.replied, row.interviewed]), [[true, true], [true, true]]);
  assert.equal(outcomes[0].features.freshnessDays, 2);
  assert.equal(outcomes[0].features.route, 'email');
});

test('missing must-haves are read from the match lines', () => {
  const match = {
    score: 40, confidence: 'high', parts: { must: 0, nice: 0, experience: 0, role: 0 }, excluded: null,
    lines: [
      { requirement: { skill: 'kubernetes', years: null }, kind: 'must', verdict: 'missing', evidence: [], note: '' },
      { requirement: { skill: 'react', years: null }, kind: 'must', verdict: 'met', evidence: [], note: '' },
      { requirement: { skill: 'go', years: null }, kind: 'nice', verdict: 'missing', evidence: [], note: '' },
    ],
  } satisfies Match;
  assert.deepEqual(missingMust({ match }), ['kubernetes']);
  assert.deepEqual(missingMust({ match: null }), []);
});
