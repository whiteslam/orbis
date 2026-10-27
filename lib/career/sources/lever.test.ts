import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLever } from './lever.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/lever.json', import.meta.url), 'utf8')) as unknown[];

test('reads a real site, naming the company from the watchlist', () => {
  const jobs = parseLever(raw, 'Lever Demo');
  assert.equal(jobs.length, 3);
  const [first] = jobs;
  assert.equal(first.sourceRef, 'ad208490-4052-4f91-a57e-433f2d1e484b');
  assert.equal(first.title, 'Customer Success Manager');
  assert.equal(first.company, 'Lever Demo');
  assert.equal(first.location, 'Atlanta, Georgia');
  assert.equal(first.remote, false);
  assert.equal(first.applyUrl, 'https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b/apply');
  assert.deepEqual(first.salary, { min: 85_000, max: 175_000, currency: 'USD', period: 'year' });
  assert.equal(first.postedAt, '2026-08-31T18:12:19.703Z');
});

test('folds the lists into the description', () => {
  const [first] = parseLever(raw, 'Lever Demo');
  assert.ok(first.description?.includes('Skill Set:\n• 3+ years of customer relationship'));
});

test('a posting with no text has a null description', () => {
  assert.equal(parseLever(raw, 'Lever Demo')[2].description, null);
});

test('reads a single posting and the remote workplace type', () => {
  const single = { ...(raw[0] as object), workplaceType: 'remote' };
  const jobs = parseLever(single, 'Acme');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].remote, true);
});
