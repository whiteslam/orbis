import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findEmails, latestHiringThread, parseHn, parseHnHeader } from './hn.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const search = read('hn-search.json');
const thread = read('hn-item.json');
const NOW = new Date('2026-10-27T12:00:00Z');

test('finds the newest "Who is hiring?" thread, not "Who wants to be hired?"', () => {
  assert.equal(latestHiringThread(search), '49922569');
  assert.equal(latestHiringThread({ hits: [{ objectID: '1', title: 'Ask HN: Who wants to be hired? (October 2026)' }] }), null);
});

test('a thread or post id that is not a number is never put into a URL', () => {
  const title = 'Ask HN: Who is hiring? (October 2026)';
  assert.equal(latestHiringThread({ hits: [{ objectID: '../users/x?y=1', title }] }), null);
  assert.equal(latestHiringThread({ hits: [{ objectID: '', title }] }), null);
  const post = { text: 'Acme | Engineer | Remote<p>Apply.', created_at_i: NOW.getTime() / 1000 };
  assert.equal(parseHn({ children: [{ ...post, id: 42 }] }, NOW).length, 1);
  assert.equal(parseHn({ children: [{ ...post, id: '42#x' }] }, NOW).length, 0);
});

test('reads each top-level post of a real thread', () => {
  const jobs = parseHn(thread, NOW);
  assert.equal(jobs.length, 5);
  const fazeshift = jobs.find((job) => job.company === 'Fazeshift');
  assert.ok(fazeshift);
  assert.equal(fazeshift.title, 'Senior Software Engineer');
  assert.equal(fazeshift.location, 'San Francisco, CA');
  assert.equal(fazeshift.remote, false);
  assert.equal(fazeshift.applyEmail, 'chris.zehner@fazeshift.com');
  assert.deepEqual(fazeshift.salary, { min: 200_000, max: 235_000, currency: 'USD', period: 'year' });
  assert.equal(fazeshift.url, 'https://news.ycombinator.com/item?id=49923384');
  assert.equal(fazeshift.attribution, 'via Hacker News');
  assert.ok(fazeshift.description?.startsWith('Fazeshift | Senior Software Engineer'));
});

test('reads a dash-separated header with the place in brackets', () => {
  const [prairie] = parseHn(thread, NOW);
  assert.equal(prairie.company, 'PrairieLearn');
  assert.equal(prairie.title, 'Full-Stack Software Engineer');
  assert.equal(prairie.location, 'Remote US');
  assert.equal(prairie.remote, true);
  assert.ok(prairie.applyUrl?.startsWith('https://www.prairielearn.com/jobs-ashby'));
});

test('de-obfuscates "[at]" addresses and never takes a profile link as the apply page', () => {
  const jobs = parseHn(thread, NOW);
  assert.equal(jobs.find((job) => job.sourceRef === '49922615')?.applyEmail, 'jobs@openeducation.foundation');
  const sidekick = jobs.find((job) => job.company === 'Sidekick Labs');
  assert.equal(sidekick?.applyEmail, 'hiring@sidekicklabs.com');
  assert.equal(sidekick?.applyUrl, null);
});

test('a post naming no single role is "Multiple roles"', () => {
  const namespace = parseHn(thread, NOW).find((job) => job.company === 'Namespace');
  assert.equal(namespace?.title, 'Multiple roles');
  assert.equal(namespace?.remote, true);
});

test('skips posts older than 40 days and deleted ones', () => {
  assert.equal(parseHn(thread, new Date('2026-12-01T00:00:00Z')).length, 0);
  assert.equal(parseHn({ children: [{ id: 1, text: null, created_at_i: NOW.getTime() / 1000 }] }, NOW).length, 0);
});

test('findEmails reads plain, bracketed and spelled-out addresses', () => {
  assert.deepEqual(findEmails('Mail jobs@acme.io.'), ['jobs@acme.io']);
  assert.deepEqual(findEmails('write to jane [at] acme [dot] com'), ['jane@acme.com']);
  assert.deepEqual(findEmails('hiring (at) bolt.dev or Hiring at bolt dot co dot uk'), ['hiring@bolt.dev', 'hiring@bolt.co.uk']);
  assert.deepEqual(findEmails('we are at Berlin and @handle on X'), []);
});

test('parseHnHeader sorts fields after the company in any order', () => {
  assert.deepEqual(parseHnHeader('Acme | REMOTE (EU) | Backend Engineer | Full-time | €80k-€100k'), {
    company: 'Acme', role: 'Backend Engineer', location: 'REMOTE (EU)', remote: true, salaryText: '€80k-€100k',
  });
});
