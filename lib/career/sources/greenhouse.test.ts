import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGreenhouse } from './greenhouse.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/greenhouse.json', import.meta.url), 'utf8')) as { jobs: unknown[] };

test('reads a real board, unescaping the doubly escaped content', () => {
  const jobs = parseGreenhouse(raw, 'Fallback');
  assert.equal(jobs.length, 3);
  const [first] = jobs;
  assert.equal(first.sourceRef, '8638232002');
  assert.equal(first.title, 'AI Transformation Owner, CRO');
  assert.equal(first.company, 'GitLab');
  assert.equal(first.location, 'Remote, United States');
  assert.equal(first.remote, true);
  assert.equal(first.url, 'https://job-boards.greenhouse.io/gitlab/jobs/8638232002');
  assert.equal(first.postedAt, '2026-07-22T17:38:40.000Z');
  assert.ok(first.description?.startsWith('GitLab is the intelligent orchestration platform'));
  assert.ok(!first.description?.includes('&lt;') && !first.description?.includes('<div'));
});

test('reads a single-job reply, as a pasted link returns', () => {
  const jobs = parseGreenhouse(raw.jobs[1]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sourceRef, '8716179002');
});

test('uses the watchlist name when the board gives none', () => {
  const [job] = parseGreenhouse({ jobs: [{ id: 1, title: 'Dev', absolute_url: 'https://x.test/1', location: { name: 'Pune' } }] }, 'Acme');
  assert.equal(job.company, 'Acme');
  assert.equal(job.remote, false);
});
