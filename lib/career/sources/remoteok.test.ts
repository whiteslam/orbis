import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRemoteOk } from './remoteok.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/remoteok.json', import.meta.url), 'utf8')) as unknown;

test('skips the legal notice and reads the jobs', () => {
  const jobs = parseRemoteOk(raw);
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].title, 'Senior Software Engineer');
  assert.equal(jobs[0].company, 'Klardaten');
  assert.equal(jobs[0].attribution, 'via Remote OK');
  assert.equal(jobs[0].postedAt, '2026-10-25T12:34:21.000Z');
});

test('repairs its double-encoded text', () => {
  const [first] = parseRemoteOk(raw);
  assert.ok(first.description?.includes('We’re hiring 1–2 senior engineers'));
  assert.ok(!first.description?.includes('â\u0080'));
});

test('reads salaries in dollars and treats zero as none', () => {
  const jobs = parseRemoteOk(raw);
  assert.deepEqual(jobs[0].salary, { min: 80_000, max: 100_000, currency: 'USD', period: 'year' });
  assert.equal(jobs[1].salary, null);
});
