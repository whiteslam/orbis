import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adzunaUrl, fetchAdzuna, parseAdzuna } from './adzuna.ts';

// Hand-written to Adzuna's documented shape: the API needs keys.
const raw = JSON.parse(readFileSync(new URL('./fixtures/adzuna.json', import.meta.url), 'utf8')) as unknown;

test('reads jobs, strips search highlighting, and skips one with no company', () => {
  const jobs = parseAdzuna(raw, 'in');
  assert.equal(jobs.length, 2);
  const [first] = jobs;
  assert.equal(first.title, 'Senior Frontend Developer');
  assert.equal(first.company, 'Acme Software Pvt Ltd');
  assert.equal(first.location, 'Bengaluru, Karnataka');
  assert.equal(first.sourceRef, '4471203391');
  assert.equal(first.postedAt, '2026-10-24T09:12:33.000Z');
  assert.equal(first.attribution, 'Jobs by Adzuna');
  assert.equal(first.thin, true);
  assert.ok(first.description?.includes('product & design'));
});

test('uses the country currency, and ignores a predicted salary', () => {
  const [first, second] = parseAdzuna(raw, 'in');
  assert.deepEqual(first.salary, { min: 1_800_000, max: 2_600_000, currency: 'INR', period: 'year' });
  assert.equal(second.salary, null);
});

test('spots remote jobs from the text', () => {
  const [first, second] = parseAdzuna(raw, 'in');
  assert.equal(first.remote, false);
  assert.equal(second.remote, true);
});

test('builds the search URL with keys and 50 results', () => {
  assert.equal(
    adzunaUrl('IN', 'react developer', 'id1', 'key1'),
    'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=id1&app_key=key1&what=react+developer&results_per_page=50&content-type=application%2Fjson',
  );
});

test('stands down without keys', async () => {
  assert.deepEqual(await fetchAdzuna({ roles: ['x'], countries: ['in'], watchlist: [], env: {} }), []);
});
