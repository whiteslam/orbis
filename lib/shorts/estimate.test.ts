import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildMinutes, estimateMakeTime, estimatesBySlug, formatMinutes, MAX_SAMPLES, PLAN_MINUTES } from './estimate';
import type { ShortJob } from './types';

const T0 = Date.parse('2026-11-10T08:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

let n = 0;
/** A finished short in `style` whose build took `minutes`, finishing `endsAt` minutes after T0. */
const done = (style: string, minutes: number, endsAt = 1000 + n): ShortJob => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, style, topic: 't', status: 'done', stage: 'build',
    options: { seconds: 30, voice: 'am_michael', mode: 'voice', music: 'bed', endLine: '' },
    plan: null, planFeedback: null, delivery: null, error: null, attempt: 1,
    createdAt: at(endsAt - minutes - 5), startedAt: at(endsAt - minutes), finishedAt: at(endsAt), lastEventAt: null,
  };
};

const COZY = { slug: 'cozy-tales', is3d: false };
const DEEP = { slug: 'deep-dive', is3d: true };

test('minutes read as minutes under an hour, half hours above', () => {
  assert.equal(formatMinutes(16.4), '16 min');
  assert.equal(formatMinutes(0.2), '1 min');
  assert.equal(formatMinutes(59.4), '59 min');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(116), '2 h');
  assert.equal(formatMinutes(95), '1.5 h');
});

test('a 2D style never made yet gets the rough 2D default', () => {
  const e = estimateMakeTime(COZY, []);
  assert.equal(e.measured, false);
  assert.equal(e.samples, 0);
  assert.equal(e.label, 'usually 15–25 min to make');
  assert.match(e.detail, /rough guess/);
});

test('a 3D style never made yet gets the rough 3D default, with the reason', () => {
  const e = estimateMakeTime(DEEP, []);
  assert.equal(e.label, 'usually 1–2 h to make');
  assert.match(e.detail, /graphics card/);
});

test('the owner’s real runs: cozy-tales 14 min build, deep-dive 1 h 53 min build', () => {
  assert.equal(estimateMakeTime(COZY, [done('cozy-tales', 14)]).label, `≈ ${14 + PLAN_MINUTES} min to make`);
  const deep = estimateMakeTime(DEEP, [done('deep-dive', 113)]);
  assert.equal(deep.measured, true);
  assert.equal(deep.label, '≈ 2 h to make');
  assert.match(deep.detail, /your last short/);
});

test('the estimate is the median build of that style only', () => {
  const jobs = [done('cozy-tales', 10), done('cozy-tales', 30), done('cozy-tales', 14), done('deep-dive', 120)];
  const e = estimateMakeTime(COZY, jobs);
  assert.equal(e.samples, 3);
  assert.equal(e.minutes, 14 + PLAN_MINUTES);
  assert.match(e.detail, /last 3 shorts/);
  // An even count takes the middle two.
  assert.equal(estimateMakeTime(COZY, [done('cozy-tales', 10), done('cozy-tales', 20)]).minutes, 15 + PLAN_MINUTES);
});

test('unfinished, failed, untimed and implausible runs are left out', () => {
  const base = done('cozy-tales', 14);
  const jobs: ShortJob[] = [
    { ...done('cozy-tales', 40), status: 'failed' },
    { ...done('cozy-tales', 40), status: 'building', finishedAt: null },
    { ...done('cozy-tales', 40), startedAt: null },
    { ...done('cozy-tales', 40), startedAt: 'not a date' },
    { ...done('cozy-tales', 40), startedAt: at(2000), finishedAt: at(1990) },
    done('cozy-tales', 13 * 60),
    base,
  ];
  assert.equal(buildMinutes(base), 14);
  const e = estimateMakeTime(COZY, jobs);
  assert.equal(e.samples, 1);
  assert.equal(e.minutes, 14 + PLAN_MINUTES);
  // Only bad rows: back to the default.
  assert.equal(estimateMakeTime(COZY, jobs.slice(0, -1)).measured, false);
});

test('only the most recent finished shorts count', () => {
  const old = Array.from({ length: MAX_SAMPLES }, (_, i) => done('cozy-tales', 60, 100 + i));
  const recent = Array.from({ length: MAX_SAMPLES }, (_, i) => done('cozy-tales', 12, 5000 + i));
  const e = estimateMakeTime(COZY, [...old, ...recent]);
  assert.equal(e.samples, MAX_SAMPLES);
  assert.equal(e.minutes, 12 + PLAN_MINUTES);
});

test('every style gets an estimate by slug', () => {
  const all = estimatesBySlug([COZY, DEEP], [done('cozy-tales', 14)]);
  assert.deepEqual(Object.keys(all), ['cozy-tales', 'deep-dive']);
  assert.equal(all['cozy-tales'].measured, true);
  assert.equal(all['deep-dive'].measured, false);
});
