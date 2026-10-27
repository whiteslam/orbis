import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHimalayas } from './himalayas.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/himalayas.json', import.meta.url), 'utf8')) as unknown;

test('reads every job in a real search reply', () => {
  const jobs = parseHimalayas(raw);
  assert.equal(jobs.length, 3);
  const [first] = jobs;
  assert.equal(first.title, 'Head of Frontend Engineering');
  assert.equal(first.company, 'Made of Storm');
  assert.equal(first.location, 'Malta');
  assert.equal(first.remote, true);
  assert.equal(first.url, 'https://himalayas.app/companies/made-of-storm/jobs/head-of-frontend-engineering');
  assert.equal(first.applyUrl, 'https://himalayas.app/companies/made-of-storm/jobs/head-of-frontend-engineering?utm_source=api');
  assert.equal(first.attribution, 'via Himalayas');
  assert.equal(first.postedAt, '2026-10-26T11:39:11.000Z');
  assert.ok(first.description && !first.description.includes('<'));
});

test('reads a stated salary and leaves an absent one null', () => {
  const jobs = parseHimalayas(raw);
  assert.equal(jobs[0].salary, null);
  assert.deepEqual(jobs[2].salary, { min: 48_000, max: 150_000, currency: 'USD', period: 'year' });
});

test('returns nothing for a malformed reply', () => {
  assert.deepEqual(parseHimalayas(null), []);
  assert.deepEqual(parseHimalayas({ jobs: [{ title: 'No company' }, 'x'] }), []);
});
