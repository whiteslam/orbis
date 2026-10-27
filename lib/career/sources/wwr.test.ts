import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWwr, wwrFeeds } from './wwr.ts';

const xml = readFileSync(new URL('./fixtures/wwr.xml', import.meta.url), 'utf8');

test('reads every item in a real feed, splitting company from title', () => {
  const jobs = parseWwr(xml);
  assert.equal(jobs.length, 4);
  const [first] = jobs;
  assert.equal(first.company, 'PlanetScale');
  assert.equal(first.title, 'Video Editor');
  assert.equal(first.location, 'Anywhere in the World');
  assert.equal(first.url, 'https://weworkremotely.com/remote-jobs/planetscale-video-editor');
  assert.equal(first.postedAt, '2026-10-27T07:31:09.000Z');
  assert.equal(first.attribution, 'via We Work Remotely');
});

test('turns the escaped HTML description into text', () => {
  const [first] = parseWwr(xml);
  assert.ok(first.description?.startsWith('Headquarters: Remote US'));
  assert.ok(!first.description?.includes('&lt;') && !first.description?.includes('<p>'));
});

test('picks category feeds from the roles, always with the all-jobs feed', () => {
  assert.deepEqual(wwrFeeds(['Frontend engineer']), [
    'https://weworkremotely.com/remote-jobs.rss',
    'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  ]);
  assert.deepEqual(wwrFeeds([]), ['https://weworkremotely.com/remote-jobs.rss']);
});
