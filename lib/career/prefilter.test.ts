import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CareerSpec } from './types.ts';
import { dealBreakerIn, prefilter, titleFitsRole } from './prefilter.ts';
import { emptySpec } from './spec.ts';

const spec: CareerSpec = { ...emptySpec(), roles: ['Frontend Engineer', 'React Developer'], dealBreakers: ['crypto', 'night shift'] };
const settings = { synonyms: [] as string[][] };
const check = (title: string, over: Partial<CareerSpec> = {}, synonyms: string[][] = []) => prefilter({ title }, { ...spec, ...over }, { synonyms });

test('titles in the target role or its synonyms pass', () => {
  for (const title of ['Senior Front-End Developer', 'Software Engineer, Frontend', 'UI Engineer', 'React.js Developer', 'Staff Frontend Engineer (Remote, India)']) {
    assert.deepEqual(prefilter({ title }, spec, settings), { pass: true, reason: null }, title);
  }
});

test('other roles fail as "not your role"', () => {
  for (const title of ['Backend Engineer', 'Back-end Engineer', 'Sales Development Representative', 'Data Scientist', 'Engineering Manager']) {
    assert.deepEqual(prefilter({ title }, spec, settings), { pass: false, reason: 'Not your role' }, title);
  }
});

test('a deal-breaker word in the title fails, whole words only', () => {
  assert.deepEqual(check('Frontend Engineer, Crypto Exchange'), { pass: false, reason: 'Deal-breaker in title: crypto' });
  assert.deepEqual(check('Frontend Engineer (Night Shift)'), { pass: false, reason: 'Deal-breaker in title: night shift' });
  assert.equal(dealBreakerIn('Cryptography Researcher', ['crypto']), null);
  assert.equal(dealBreakerIn('Senior Crypto Frontend Engineer', ['Crypto']), 'Crypto');
});

test('data scientist and ML engineer do not match each other', () => {
  assert.equal(titleFitsRole('ML Engineer', 'Data Scientist'), false);
  assert.equal(titleFitsRole('Senior Data Scientist', 'Data Scientist'), true);
  assert.equal(titleFitsRole('Machine Learning Engineer', 'ML Engineer'), true);
});

test('built-in synonyms: SDE ~ software engineer, SRE ~ DevOps', () => {
  assert.equal(titleFitsRole('SDE II', 'Software Engineer'), true);
  assert.equal(titleFitsRole('Site Reliability Engineer', 'DevOps Engineer'), true);
  assert.equal(titleFitsRole('Fullstack Developer', 'Full Stack Engineer'), true);
});

test('owner synonyms widen the match', () => {
  assert.equal(check('Web Developer').pass, false);
  assert.equal(check('Web Developer', {}, [['frontend', 'web developer']]).pass, true);
});

test('a role made only of generic words still matches on them', () => {
  assert.equal(titleFitsRole('Developer', 'Developer'), true);
});

test('with no target roles everything passes the role check', () => {
  assert.deepEqual(check('Backend Engineer', { roles: [] }), { pass: true, reason: null });
  assert.equal(check('Crypto Backend Engineer', { roles: [] }).pass, false);
});
