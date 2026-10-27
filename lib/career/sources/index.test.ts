import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../types.ts';
import { fetchPastedJob, pastedUrlKind, SOURCES, sourcesDue } from './index.ts';

const NOW = new Date('2026-10-27T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const ids = (list: Array<{ id: string }>) => list.map((source) => source.id);

test('every source is registered once, and none of the alert-only boards is', () => {
  const all = ids(SOURCES);
  assert.equal(new Set(all).size, all.length);
  for (const banned of ['linkedin', 'indeed', 'naukri', 'gmail_alerts', 'pasted']) assert.ok(!all.includes(banned));
});

test('everything enabled is due when nothing was fetched yet', () => {
  assert.equal(sourcesDue({}, NOW, DEFAULT_SETTINGS.sources).length, SOURCES.length);
});

test('honours each interval, with ten minutes of slack for the cron', () => {
  const cursors = { remotive: hoursAgo(5), himalayas: hoursAgo(23.9), remoteok: hoursAgo(2.9), wwr: hoursAgo(1) };
  const due = ids(sourcesDue(cursors, NOW, DEFAULT_SETTINGS.sources));
  assert.ok(!due.includes('remotive'));
  assert.ok(due.includes('himalayas'));
  assert.ok(due.includes('remoteok'));
  assert.ok(!due.includes('wwr'));
});

test('skips switched-off sources, and those missing env when env is given', () => {
  const due = ids(sourcesDue({}, NOW, { ...DEFAULT_SETTINGS.sources, hn: false }, {}));
  assert.ok(!due.includes('hn'));
  assert.ok(!due.includes('adzuna'));
  assert.ok(ids(sourcesDue({}, NOW, DEFAULT_SETTINGS.sources, { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' })).includes('adzuna'));
});

test('puts the least recently fetched first and treats a bad cursor as never', () => {
  const due = ids(sourcesDue({ remoteok: hoursAgo(10), wwr: hoursAgo(30), hn: 'garbage' }, NOW, { remoteok: true, wwr: true, hn: true }));
  assert.deepEqual(due, ['hn', 'wwr', 'remoteok']);
});

test('recognises ATS job links', () => {
  assert.deepEqual(pastedUrlKind('https://job-boards.greenhouse.io/gitlab/jobs/8638232002'), { kind: 'greenhouse', token: 'gitlab', id: '8638232002' });
  assert.deepEqual(pastedUrlKind('https://boards.greenhouse.io/embed/job_app?for=acme&token=123'), { kind: 'greenhouse', token: 'acme', id: '123' });
  assert.deepEqual(pastedUrlKind('https://jobs.lever.co/leverdemo/ad208490-4052/apply'), { kind: 'lever', site: 'leverdemo', id: 'ad208490-4052', eu: false });
  assert.deepEqual(pastedUrlKind('https://jobs.eu.lever.co/acme/abc'), { kind: 'lever', site: 'acme', id: 'abc', eu: true });
  assert.deepEqual(pastedUrlKind('https://jobs.ashbyhq.com/ramp/34413f8d/application'), { kind: 'ashby', board: 'ramp', id: '34413f8d' });
  assert.deepEqual(pastedUrlKind('https://channable.recruitee.com/o/senior-engineer'), { kind: 'recruitee', company: 'channable', slug: 'senior-engineer' });
});

test('refuses other links, including the alert-only boards', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/4012345678/',
    'https://in.indeed.com/viewjob?jk=abc123',
    'https://www.naukri.com/job-listings-react-developer-acme-271025012345',
    'https://boards.greenhouse.io/gitlab',
    'https://boards.greenhouse.io/embed/job_app?for=..&token=123',
    'https://boards.greenhouse.io/embed/job_app?for=.&token=123',
    'https://boards.greenhouse.io/embed/job_app?for=acme/../other&token=123',
    'https://jobs.lever.co/acme',
    'not a url',
    'javascript:alert(1)',
  ]) {
    assert.equal(pastedUrlKind(url), null, url);
  }
});

test('fetchPastedJob returns null for a non-ATS link without fetching it', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  try {
    assert.equal(await fetchPastedJob('https://www.linkedin.com/jobs/view/4012345678/'), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
