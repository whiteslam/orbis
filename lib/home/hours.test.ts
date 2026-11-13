import { test } from 'vitest';
import assert from 'node:assert/strict';
import { curveLabels, curvePoints, hourLabel, nextHours } from './hours.ts';
import type { HourTemp } from './hours.ts';

const hourly = (n: number): { times: string[]; temps: number[] } => {
  const times: string[] = [];
  const temps: number[] = [];
  for (let i = 0; i < n; i++) {
    const day = 13 + Math.floor(i / 24);
    times.push(`2026-11-${day}T${String(i % 24).padStart(2, '0')}:00`);
    temps.push(20 + (i % 10));
  }
  return { times, temps };
};

test('hourLabel names noon, midnight and the am/pm hours', () => {
  assert.equal(hourLabel('2026-09-25T12:00'), 'noon');
  assert.equal(hourLabel('2026-09-25T00:00'), 'midnight');
  assert.equal(hourLabel('2026-09-25T21:00'), '9 pm');
  assert.equal(hourLabel('2026-09-25T09:00'), '9 am');
});

test('nextHours drops nulls and past hours', () => {
  const out = nextHours(['2026-11-13T12:00', '2026-11-13T13:00', '2026-11-13T14:00', '2026-11-13T15:00'], [27, 28.4, null, 29.6], '2026-11-13T13');
  assert.deepEqual(out, [{ hour: '1 pm', temperature: 28 }, { hour: '3 pm', temperature: 30 }]);
});

test('nextHours skips undefined and non-finite temperatures', () => {
  const out = nextHours(['2026-11-13T13:00', '2026-11-13T14:00', '2026-11-13T15:00'], [undefined, Number.NaN, 21], '2026-11-13T13');
  assert.deepEqual(out, [{ hour: '3 pm', temperature: 21 }]);
});

test('nextHours stops at count', () => {
  const { times, temps } = hourly(30);
  const out = nextHours(times, temps, '2026-11-13T00');
  assert.equal(out.length, 12);
  assert.equal(out[0].hour, 'midnight');
  assert.equal(nextHours(times, temps, '2026-11-13T00', 5).length, 5);
});

test('curvePoints returns [] under 2 hours', () => {
  assert.deepEqual(curvePoints([{ hour: '1 pm', temperature: 28 }], 300, 60), []);
  assert.deepEqual(curvePoints([], 300, 60), []);
});

test('curvePoints puts the warmest hour at the top and the coldest at the bottom', () => {
  const hours: HourTemp[] = [
    { hour: '1 pm', temperature: 20 },
    { hour: '2 pm', temperature: 30 },
    { hour: '3 pm', temperature: 25 },
  ];
  const pts = curvePoints(hours, 300, 60, 6);
  assert.equal(pts.length, 3);
  assert.equal(pts[1].y, 6);
  assert.equal(pts[0].y, 54);
  assert.equal(pts[2].y, 30);
  assert.equal(pts[0].x, 6);
  assert.equal(pts[1].x, 150);
  assert.equal(pts[2].x, 294);
});

test('curvePoints draws a flat line mid-height when every hour is the same', () => {
  const pts = curvePoints([{ hour: 'a', temperature: 25 }, { hour: 'b', temperature: 25 }], 100, 60);
  assert.deepEqual(pts.map((p) => p.y), [30, 30]);
});

test('curveLabels keeps the first and last of 12 and returns 4', () => {
  const hours: HourTemp[] = Array.from({ length: 12 }, (_, i) => ({ hour: `h${i}`, temperature: 20 + i }));
  const out = curveLabels(hours);
  assert.equal(out.length, 4);
  assert.equal(out[0], hours[0]);
  assert.equal(out[3], hours[11]);
});

test('curveLabels returns everything when there are fewer hours than labels', () => {
  const hours: HourTemp[] = [{ hour: 'a', temperature: 1 }, { hour: 'b', temperature: 2 }];
  assert.deepEqual(curveLabels(hours), hours);
  assert.deepEqual(curveLabels([]), []);
});
