import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { NormalizedJob } from './types.ts';
import { dedupeKey, richerJob } from './dedupe.ts';

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'remotive', sourceRef: 'r-1', title: 'Senior Frontend Engineer', company: 'Acme Inc.', location: null, remote: true,
  url: 'https://remotive.com/remote-jobs/software-dev/senior-frontend-engineer-1', applyUrl: null, applyEmail: null,
  description: 'We are looking for a senior frontend engineer with React and TypeScript.', thin: false, salary: null,
  postedAt: '2026-10-25', attribution: 'via Remotive', ...over,
});

const alert = job({
  source: 'gmail_alerts', sourceRef: 'li-4012345', title: 'Sr. Front-end Engineer (Remote)', company: 'Acme', location: 'India',
  url: 'https://www.linkedin.com/jobs/view/4012345', description: null, thin: true, postedAt: '2026-10-24', attribution: null,
});

test('the same opening from a board and an alert email shares a key', () => {
  assert.equal(dedupeKey(job()), dedupeKey(alert));
  assert.equal(dedupeKey(job()), 'acme|senior frontend engineer|remote');
});

test('different seniority, company or city are different jobs', () => {
  assert.notEqual(dedupeKey(job()), dedupeKey(job({ title: 'Junior Frontend Engineer' })));
  assert.notEqual(dedupeKey(job()), dedupeKey(job({ company: 'Acme Health' })));
  const onsite = (location: string) => job({ remote: false, location });
  assert.equal(dedupeKey(onsite('Bangalore, India')), dedupeKey(onsite('Bengaluru, Karnataka')));
  assert.notEqual(dedupeKey(onsite('Bengaluru')), dedupeKey(onsite('Pune')));
});

test('the richer description wins, and gaps fill from the other sighting', () => {
  const board = job({ salary: null, applyEmail: null, postedAt: '2026-10-25' });
  const thin = { ...alert, salary: { min: 2_500_000, max: 3_500_000, currency: 'INR', period: 'year' as const }, applyEmail: 'jobs@acme.dev' };
  const merged = richerJob(thin, board);
  assert.equal(merged.source, 'remotive');
  assert.equal(merged.description, board.description);
  assert.equal(merged.thin, false);
  assert.deepEqual(merged.salary, thin.salary);
  assert.equal(merged.applyEmail, 'jobs@acme.dev');
  assert.equal(merged.location, 'India');
  assert.equal(merged.postedAt, '2026-10-24');
  assert.equal('recruitee' in merged, false);
});

test('a salary with both ends beats one with only one', () => {
  const one = job({ salary: { min: 100_000, max: null, currency: 'USD', period: 'year' } });
  const both = job({ description: 'short', salary: { min: 100_000, max: 140_000, currency: 'USD', period: 'year' } });
  assert.deepEqual(richerJob(one, both).salary, both.salary);
});

test('Recruitee coordinates survive the merge', () => {
  const recruitee = job({ source: 'recruitee', description: 'x', recruitee: { company: 'acme', offer: 'senior-frontend' } });
  assert.deepEqual(richerJob(job(), recruitee).recruitee, { company: 'acme', offer: 'senior-frontend' });
});
