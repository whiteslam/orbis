import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAshby } from './ashby.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/ashby.json', import.meta.url), 'utf8')) as { jobs: Array<Record<string, unknown>> };

test('reads a real board with compensation', () => {
  const jobs = parseAshby(raw, 'Ramp');
  assert.equal(jobs.length, 3);
  const [first] = jobs;
  // The board sends the title with a leading space.
  assert.equal(first.title, 'Security Engineer, Cloud');
  assert.equal(first.company, 'Ramp');
  assert.equal(first.location, 'New York, NY (HQ)');
  assert.equal(first.remote, true);
  assert.equal(first.applyUrl, 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application');
  assert.deepEqual(first.salary, { min: 211_400, max: 290_600, currency: 'USD', period: 'year' });
  assert.equal(first.postedAt, '2026-04-07T17:12:35.753Z');
  assert.ok(first.description?.startsWith('ABOUT RAMP'));
});

test('no compensation means no salary; unlisted postings are skipped', () => {
  assert.equal(parseAshby(raw, 'Ramp')[2].salary, null);
  const unlisted = { jobs: [{ ...raw.jobs[0], isListed: false }] };
  assert.deepEqual(parseAshby(unlisted, 'Ramp'), []);
});
