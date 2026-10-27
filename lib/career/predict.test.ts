import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MIN_OUTCOMES, PRIOR_MODEL, featuresOf, fitLogistic, forecast, predict, predictApplication, salaryFitOf, seniorityFitOf,
  train, type Features, type Outcome,
} from './predict.ts';
import type { Prediction } from './types.ts';

const base: Features = { route: 'link', score: 50, freshnessDays: 3, salaryFit: 0, seniorityFit: 0, thin: false };
const at = (over: Partial<Features>) => predict({ ...base, ...over }, PRIOR_MODEL.reply).p;

test('the prior: a typical link application hears back about 12% of the time', () => {
  assert.ok(Math.abs(at({}) - 0.12) < 0.005);
});

test('the prior ranks routes, scores, freshness and fit the documented way', () => {
  assert.ok(at({ route: 'email' }) > at({ route: 'recruitee' }));
  assert.ok(at({ route: 'recruitee' }) > at({ route: 'link' }));
  assert.ok(at({ score: 80 }) > at({ score: 55 }));
  assert.ok(at({ freshnessDays: 0 }) > at({ freshnessDays: 20 }));
  assert.ok(at({ salaryFit: 1 }) > at({ salaryFit: -1 }));
  assert.ok(at({ seniorityFit: 1 }) > at({ seniorityFit: -1 }));
  assert.ok(at({ thin: true }) < at({}));
  assert.ok(predict(base, PRIOR_MODEL.interview).p < at({}));
});

test('early ranges are wide, and always inside 0–1', () => {
  const { p, range } = predict(base, PRIOR_MODEL.reply);
  assert.ok(range[0] <= p && p <= range[1]);
  assert.ok(range[1] - range[0] > 0.3);
  assert.ok(range[0] >= 0 && range[1] <= 1);
});

const outcome = (route: Features['route'], replied: boolean, interviewed = false): Outcome => ({ features: { ...base, route }, replied, interviewed });

test('below 15 outcomes the model is the prior, flagged early', () => {
  const model = train(Array.from({ length: MIN_OUTCOMES - 1 }, () => outcome('link', true)));
  assert.equal(model.reply.early, true);
  assert.equal(model.reply.n, MIN_OUTCOMES - 1);
  assert.deepEqual(model.reply.weights, PRIOR_MODEL.reply.weights);
});

test('learning moves towards the owner\'s outcomes, deterministically', () => {
  const outcomes = [
    ...Array.from({ length: 20 }, () => outcome('email', true, true)),
    ...Array.from({ length: 20 }, () => outcome('link', false)),
  ];
  const model = train(outcomes);
  assert.equal(model.reply.early, false);
  assert.equal(model.reply.n, 40);
  assert.deepEqual(train(outcomes), model);
  const email = predict({ ...base, route: 'email' }, model.reply);
  const link = predict(base, model.reply);
  assert.ok(email.p > predict({ ...base, route: 'email' }, PRIOR_MODEL.reply).p);
  // The gap between routes widens towards what the owner saw.
  assert.ok(email.p - link.p > at({ route: 'email' }) - at({}) + 0.2);
  // More data, narrower range.
  assert.ok(email.range[1] - email.range[0] < 0.35);
});

test('fitLogistic separates a clean signal', () => {
  const rows = [[1, 0], [1, 0], [1, 1], [1, 1]];
  const weights = fitLogistic(rows, [false, false, true, true]);
  assert.ok(weights[1] > 0.5);
  assert.ok(weights[0] < 0);
  assert.deepEqual(fitLogistic([], []), []);
});

test('salary and seniority fit', () => {
  const spec = { salaryFloor: { amount: 1_500_000, currency: 'INR', period: 'year' as const }, salaryTarget: { amount: 2_400_000, currency: 'INR', period: 'year' as const } };
  assert.equal(salaryFitOf({ min: 1_000_000, max: 1_200_000, currency: 'INR', period: 'year' }, spec), -1);
  assert.equal(salaryFitOf({ min: 1_800_000, max: 2_000_000, currency: 'INR', period: 'year' }, spec), 0);
  assert.equal(salaryFitOf({ min: null, max: 220_000, currency: 'INR', period: 'month' }, spec), 1);
  assert.equal(salaryFitOf({ min: 90_000, max: 120_000, currency: 'USD', period: 'year' }, spec), 0);
  assert.equal(salaryFitOf(null, spec), 0);
  assert.equal(seniorityFitOf('senior', ['senior', 'lead']), 1);
  assert.equal(seniorityFitOf('junior', ['senior']), -1);
  assert.equal(seniorityFitOf(null, ['senior']), 0);
});

test('predictApplication builds features from the job and spec', () => {
  const input = {
    route: 'email' as const, score: 72, appliedAt: '2026-10-27T10:00:00Z',
    job: { postedAt: '2026-10-26', thin: false, salary: null, requirements: { seniority: 'senior' as const, salary: null } },
    spec: { salaryFloor: null, salaryTarget: null, seniority: ['senior' as const] },
  };
  assert.deepEqual(featuresOf(input), { route: 'email', score: 72, freshnessDays: 1, salaryFit: 0, seniorityFit: 1, thin: false });
  const prediction = predictApplication(input, PRIOR_MODEL);
  assert.equal(prediction.early, true);
  assert.equal(prediction.basedOn, 0);
  assert.ok(prediction.reply > prediction.interview);
  assert.ok(prediction.replyRange[0] <= prediction.reply && prediction.reply <= prediction.replyRange[1]);
});

const pred = (reply: number, interview: number): Prediction => ({
  reply, replyRange: [reply * 0.8, reply * 1.2], interview, interviewRange: [interview * 0.8, interview * 1.2], early: false, basedOn: 40,
});

test('forecast with nothing open', () => {
  assert.deepEqual(forecast([], [], '2026-10-27'), { days: 14, replies: [0, 0], interviews: [0, 0], early: true });
});

test('forecast spreads chances over the reply delay', () => {
  const fresh = Array.from({ length: 10 }, () => ({ prediction: pred(0.5, 0.2), sentAt: '2026-10-27' }));
  const result = forecast(fresh, [], '2026-10-27');
  // 10 × 0.5 × 90% of replies within 14 days ≈ 4.5.
  assert.ok(result.replies[0] <= 4 && result.replies[1] >= 5, String(result.replies));
  assert.ok(result.replies[1] <= 10);
  assert.ok(result.interviews[1] < result.replies[1]);
  assert.equal(result.early, true);
});

test('old silent applications add almost nothing; observed delays replace the prior', () => {
  const stale = Array.from({ length: 10 }, () => ({ prediction: pred(0.5, 0.2), sentAt: '2026-08-01' }));
  assert.deepEqual(forecast(stale, [], '2026-10-27').replies, [0, 0]);
  const observed = [1, 1, 2, 2, 2, 3, 3, 4, 5, 6];
  const result = forecast([{ prediction: pred(0.5, 0.2), sentAt: '2026-10-27' }], observed, '2026-10-27');
  assert.equal(result.early, false);
});
