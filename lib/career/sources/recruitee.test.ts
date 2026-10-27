import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecruitee } from './recruitee.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/recruitee.json', import.meta.url), 'utf8')) as { offers: unknown[] };

test('reads a real careers site and keeps what Send needs', () => {
  const jobs = parseRecruitee(raw, 'channable');
  assert.equal(jobs.length, 3);
  const [first] = jobs;
  assert.equal(first.sourceRef, '2793226');
  assert.equal(first.title, 'Senior Engineering Manager - Core');
  assert.equal(first.company, 'Channable');
  assert.equal(first.location, 'Utrecht, Utrecht, Netherlands');
  assert.equal(first.remote, false);
  assert.equal(first.url, 'https://jobs.channable.com/o/senior-engineering-manager-core');
  assert.equal(first.applyUrl, 'https://jobs.channable.com/o/senior-engineering-manager-core/c/new');
  assert.deepEqual(first.recruitee, { company: 'channable', offer: 'senior-engineering-manager-core' });
  assert.equal(first.postedAt, '2026-10-22T12:11:23.000Z');
});

test('reads yearly and monthly salaries', () => {
  const jobs = parseRecruitee(raw, 'channable');
  assert.deepEqual(jobs[0].salary, { min: 100_000, max: 120_000, currency: 'EUR', period: 'year' });
  assert.deepEqual(jobs[1].salary, { min: 4000, max: 5700, currency: 'EUR', period: 'month' });
});

test('joins description and requirements as text', () => {
  const [first] = parseRecruitee(raw, 'channable');
  assert.ok(first.description?.includes('What do we offer?'));
  assert.ok(!first.description?.includes('<span'));
});

test('reads a single-offer reply', () => {
  const jobs = parseRecruitee({ offer: raw.offers[0] }, 'channable');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].recruitee?.offer, 'senior-engineering-manager-core');
});
