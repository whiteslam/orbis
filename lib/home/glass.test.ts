import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { glassActivity, restOfToday, SKY_PHOTOS, skyFor, STEP_GOAL, type Sky } from './glass.ts';
import type { RoutineEvent, RoutineToday } from '../routines/types.ts';

test('STEP_GOAL is 10,000', () => {
  assert.equal(STEP_GOAL, 10_000);
});

test('glassActivity ignores steps from another day', () => {
  const a = glassActivity({ latest: { date: '2026-09-28', steps: 2772 }, today: '2026-11-13', done: 1, total: 4 });
  assert.equal(a.steps, null);
  assert.equal(a.stepShare, 0);
  assert.equal(a.routineShare, 0.25);
});

test('glassActivity uses today’s steps and clamps the share', () => {
  const a = glassActivity({ latest: { date: '2026-11-13', steps: 12_500 }, today: '2026-11-13', done: 5, total: 4 });
  assert.equal(a.steps, 12_500);
  assert.equal(a.stepShare, 1);
  assert.equal(a.routineShare, 1);
  const half = glassActivity({ latest: { date: '2026-11-13', steps: 5000 }, today: '2026-11-13', done: 0, total: 0 });
  assert.equal(half.stepShare, 0.5);
  assert.equal(half.routineShare, 0);
  assert.equal(half.done, 0);
  assert.equal(half.total, 0);
});

test('glassActivity with no sync at all has null steps', () => {
  const a = glassActivity({ latest: null, today: '2026-11-13', done: 2, total: 4 });
  assert.equal(a.steps, null);
  assert.equal(a.stepShare, 0);
  assert.equal(a.routineShare, 0.5);
});

const event: RoutineEvent = { id: 'e', routineId: 'r', title: 'x', localDate: '2026-11-13', status: 'done', note: null };
const due = (id: string, title: string, atTime: string, minutesAway: number, ev: RoutineEvent | null = null): RoutineToday => ({
  routine: { id, title, kind: 'other', atTime, days: [0, 1, 2, 3, 4, 5, 6], active: true, flexible: false, archivedAt: null },
  minutesAway,
  event: ev,
});

test('restOfToday keeps upcoming unanswered routines in order, at most 4', () => {
  const list = [
    due('past', 'Past', '08:00', -300),
    due('answered', 'Answered', '15:00', 60, event),
    due('e', 'Sixth', '22:00', 540),
    due('a', 'First', '14:30', 30),
    due('b', 'Second', '17:00', 210),
    due('c', 'Third', '18:30', 300),
    due('d', 'Fourth', '20:00', 420),
    due('now', 'Due now', '14:00', 0),
  ];
  const out = restOfToday(list);
  assert.deepEqual(out, [
    { id: 'a', name: 'First', time: '14:30' },
    { id: 'b', name: 'Second', time: '17:00' },
    { id: 'c', name: 'Third', time: '18:30' },
    { id: 'd', name: 'Fourth', time: '20:00' },
  ]);
  assert.equal(restOfToday(list, 2).length, 2);
});

test('skyFor picks night first, then rain, cloud and clear', () => {
  assert.equal(skyFor({ isDay: false, rainingNow: true, weatherCode: 61 }), 'night');
  assert.equal(skyFor({ isDay: true, rainingNow: true, weatherCode: 61 }), 'rain');
  assert.equal(skyFor({ isDay: true, rainingNow: false, weatherCode: 3 }), 'cloud');
  assert.equal(skyFor({ isDay: true, rainingNow: false, weatherCode: 48 }), 'cloud');
  assert.equal(skyFor({ isDay: true, rainingNow: false, weatherCode: 0 }), 'clear');
});

test('every sky has a photo in public/ and a credit', () => {
  const skies: Sky[] = ['night', 'rain', 'cloud', 'clear'];
  for (const sky of skies) {
    const photo = SKY_PHOTOS[sky];
    assert.match(photo.src, /^\/today\/sky\/[a-z]+\.jpg$/);
    assert.ok(existsSync(join(process.cwd(), 'public', photo.src)), `${photo.src} is missing`);
    assert.ok(photo.author.length > 0);
    assert.match(photo.license, /^CC /);
    assert.match(photo.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
});
