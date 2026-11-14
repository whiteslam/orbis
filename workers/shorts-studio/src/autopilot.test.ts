import assert from 'node:assert/strict';
import { test } from 'vitest';
import { youtubeShelf } from './autopilot.ts';

const connected = { status: 'connected' };

test('there is no YouTube shelf without a connection, or while it needs connecting again', () => {
  assert.equal(youtubeShelf({ connection: null, postTimes: ['09:00'], queued: 0, building: 0 }), null);
  assert.equal(youtubeShelf({ connection: { status: 'reconnect_required' }, postTimes: ['09:00'], queued: 0, building: 0 }), null);
});

test('the YouTube shelf counts queued videos and builds in progress, at the schedule’s posts a day', () => {
  assert.deepEqual(youtubeShelf({ connection: connected, postTimes: ['09:00', '18:00'], queued: 3, building: 1 }),
    { destination: 'youtube', postsPerDay: 2, onShelf: 4 });
  assert.equal(youtubeShelf({ connection: connected, postTimes: null, queued: 0, building: 0 })?.postsPerDay, 1);
  assert.equal(youtubeShelf({ connection: connected, postTimes: [], queued: 0, building: 0 })?.postsPerDay, 1);
});
