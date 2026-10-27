import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  FRESHNESS_PRIOR, bestDay, buildInsights, freshnessAdvice, funnel, isoWeek, marketPulse, quantile, recentWeeks, replyDelays,
  salaryPulse, skillGaps, sourceStats,
} from './insights.ts';

test('ISO weeks, including the year edges', () => {
  assert.equal(isoWeek('2026-10-27'), '2026-W44');
  assert.equal(isoWeek('2027-01-01T08:00:00Z'), '2026-W53');
  assert.equal(isoWeek('2024-12-30'), '2025-W01');
  assert.deepEqual(recentWeeks('2026-10-27', 3), ['2026-W42', '2026-W43', '2026-W44']);
});

test('skill gaps count exactly the jobs a skill would lift over the bar', () => {
  const jobs = [
    { id: 'j1', score: 45, missingMust: ['Kubernetes', 'Go'] },
    { id: 'j2', score: 40, missingMust: ['kubernetes'] },
    { id: 'j3', score: 70, missingMust: ['Kubernetes'] },
    { id: 'j4', score: 30, missingMust: ['Go'] },
    { id: 'j5', score: 20, missingMust: ['Rust'] },
  ];
  const lift: Record<string, number> = { 'j1|Kubernetes': 55, 'j2|Kubernetes': 52, 'j1|Go': 49, 'j4|Go': 38 };
  const gaps = skillGaps({ jobs, threshold: 50, rescoreWith: (jobId, skill) => lift[`${jobId}|${skill}`] ?? 0 });
  assert.deepEqual(gaps, [
    { skill: 'Kubernetes', jobsMissingIt: 3, jobsItWouldUnlock: 2 },
    { skill: 'Go', jobsMissingIt: 2, jobsItWouldUnlock: 0 },
  ]);
});

test('salary pulse needs five listings per currency and period', () => {
  const job = (min: number, max: number | null, currency = 'INR') => ({ title: 'Frontend engineer', salary: { min, max, currency, period: 'year' as const } });
  const jobs = [job(10, 20), job(20, null), job(30, 30), job(40, 40), job(50, 50), job(1, 2, 'USD'), { title: 'Chef', salary: { min: 999, max: 999, currency: 'INR', period: 'year' as const } }];
  const pulse = salaryPulse(jobs, (title) => title.includes('engineer'));
  assert.deepEqual(pulse, [{ currency: 'INR', period: 'year', p25: 20, p50: 30, p75: 40, sample: 5 }]);
  assert.equal(quantile([1, 3], 0.5), 2);
});

test('market pulse counts matching jobs per week with empty weeks kept', () => {
  const market = marketPulse([
    { foundAt: '2026-10-26T10:00:00Z', score: 80 },
    { foundAt: '2026-10-27T10:00:00Z', score: 40 },
    { foundAt: '2026-10-20T10:00:00Z', score: 60 },
    { foundAt: '2025-01-01T10:00:00Z', score: 90 },
    { foundAt: '2026-10-27T10:00:00Z', score: null },
  ], 50, '2026-10-27', 3);
  assert.deepEqual(market, [{ week: '2026-W42', jobs: 0 }, { week: '2026-W43', jobs: 1 }, { week: '2026-W44', jobs: 1 }]);
});

test('source stats', () => {
  const stats = sourceStats(
    [{ id: 'a', source: 'remotive', score: 70 }, { id: 'b', source: 'remotive', score: 20 }, { id: 'c', source: 'hn', score: 90 }],
    [{ jobId: 'a', status: 'interview', sentAt: '2026-10-01' }, { jobId: 'c', status: 'ready', sentAt: null }],
    50,
  );
  assert.deepEqual(stats, [
    { source: 'remotive', jobs: 2, matches: 1, applied: 1, replies: 1 },
    { source: 'hn', jobs: 1, matches: 1, applied: 0, replies: 0 },
  ]);
});

test('freshness advice stays the prior until 20 outcomes', () => {
  assert.deepEqual(freshnessAdvice([{ freshnessDays: 1, replied: true }]), { advice: FRESHNESS_PRIOR, fromData: false });
  const outcomes = [
    ...Array.from({ length: 10 }, (_, index) => ({ freshnessDays: 1, replied: index < 4 })),
    ...Array.from({ length: 10 }, (_, index) => ({ freshnessDays: 20, replied: index < 1 })),
  ];
  const advice = freshnessAdvice(outcomes);
  assert.equal(advice.fromData, true);
  assert.match(advice.advice, /within 2 days of posting: 4 of 10 \(40%\), against 25% overall/);
});

test('best day needs 30 sent applications', () => {
  assert.deepEqual(bestDay([{ sentAt: '2026-10-27T10:00:00Z', replied: true }]), { day: null, needMore: 29 });
  const sent = [
    // Tuesdays reply, Mondays don't.
    ...Array.from({ length: 15 }, () => ({ sentAt: '2026-10-27T10:00:00Z', replied: true })),
    ...Array.from({ length: 15 }, () => ({ sentAt: '2026-10-26T10:00:00Z', replied: false })),
  ];
  assert.deepEqual(bestDay(sent), { day: 'Tuesday', needMore: 0 });
  // 22:00 UTC Monday is Tuesday morning in Kolkata.
  const late = Array.from({ length: 30 }, () => ({ sentAt: '2026-10-26T22:00:00Z', replied: true }));
  assert.equal(bestDay(late, 'Asia/Kolkata').day, 'Tuesday');
});

test('funnel counts applications per week, once each', () => {
  const rows = funnel([
    { id: 'e1', kind: 'sent', at: '2026-10-26T10:00:00Z', applicationId: 'a' },
    { id: 'e2', kind: 'reply', at: '2026-10-27T10:00:00Z', applicationId: 'a' },
    { id: 'e3', kind: 'interview_invite', at: '2026-10-27T11:00:00Z', applicationId: 'a' },
    { id: 'e4', kind: 'acknowledgement', at: '2026-10-27T11:00:00Z', applicationId: 'b' },
    { id: 'e5', kind: 'rejection', at: '2026-10-21T11:00:00Z', applicationId: null },
  ], '2026-10-27', 2);
  assert.deepEqual(rows, [
    { week: '2026-W43', sent: 0, replies: 1, interviews: 0 },
    { week: '2026-W44', sent: 1, replies: 1, interviews: 1 },
  ]);
});

test('replyDelays takes the first reply per application', () => {
  assert.deepEqual(replyDelays(
    [{ id: 'a', sentAt: '2026-10-01' }, { id: 'b', sentAt: '2026-10-01' }],
    [
      { kind: 'reply', at: '2026-10-09T10:00:00Z', applicationId: 'a' },
      { kind: 'rejection', at: '2026-10-04T10:00:00Z', applicationId: 'a' },
      { kind: 'acknowledgement', at: '2026-10-02T10:00:00Z', applicationId: 'b' },
    ],
  ), [3]);
});

test('buildInsights composes every card', () => {
  const insights = buildInsights({
    today: '2026-10-27',
    threshold: 50,
    timeZone: 'UTC',
    jobs: [{ id: 'j', source: 'remotive', title: 'Engineer', score: 60, foundAt: '2026-10-26', salary: null, missingMust: [] }],
    applications: [{
      jobId: 'j', status: 'sent', sentAt: '2026-10-26', freshnessDays: 1,
      prediction: { reply: 0.2, replyRange: [0.1, 0.3], interview: 0.05, interviewRange: [0, 0.1], early: true, basedOn: 0 },
    }],
    events: [],
    replyDelayDays: [],
    rescoreWith: () => 0,
    roleMatch: () => true,
  });
  assert.equal(insights.forecast.early, true);
  assert.equal(insights.market.length, 8);
  assert.equal(insights.funnel.length, 8);
  assert.deepEqual(insights.bestDay, { day: null, needMore: 29 });
  assert.equal(insights.freshness.fromData, false);
  assert.equal(insights.sources[0].applied, 1);
});
