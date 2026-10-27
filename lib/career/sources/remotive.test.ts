import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRemotive, remotiveUrl } from './remotive.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/remotive.json', import.meta.url), 'utf8')) as unknown;

test('reads every job in a real reply, timestamps as UTC', () => {
  const jobs = parseRemotive(raw);
  assert.equal(jobs.length, 4);
  const [first] = jobs;
  assert.equal(first.sourceRef, '2091161');
  assert.equal(first.company, 'iMerit Technology');
  assert.equal(first.location, 'Worldwide');
  assert.equal(first.remote, true);
  assert.equal(first.attribution, 'via Remotive');
  assert.equal(first.postedAt, '2026-10-22T18:40:19.000Z');
});

test('reads free-text salaries, refusing pay per task', () => {
  const salaries = parseRemotive(raw).map((job) => job.salary);
  assert.deepEqual(salaries[0], { min: 70_000, max: 80_000, currency: 'USD', period: 'year' });
  assert.equal(salaries[1], null);
  assert.deepEqual(salaries[2], { min: 170_000, max: 200_000, currency: 'USD', period: 'year' });
  assert.deepEqual(salaries[3], { min: 35_300, max: 52_000, currency: 'USD', period: 'year' });
});

test('makes one request a run: a search for one role, else the whole list', () => {
  assert.equal(remotiveUrl(['React developer']), 'https://remotive.com/api/remote-jobs?search=React%20developer');
  assert.equal(remotiveUrl(['A', 'B']), 'https://remotive.com/api/remote-jobs');
});
