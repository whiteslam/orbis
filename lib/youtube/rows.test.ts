import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readPostTimes, readPresetRow, readQueueItem, readQueueRow, readScheduleRow } from './rows.ts';

test('a schedule row reads the time column as HH:MM and keeps the hold', () => {
  const schedule = readScheduleRow({ post_time: '18:05:00', days: [5, 1, 1, 9], timezone: 'America/New_York', paused: true, hold_until: '2026-11-14T05:00:00+00:00' }, 'Asia/Kolkata');
  assert.deepEqual(schedule, { postTimes: ['18:05'], days: [1, 5], timezone: 'America/New_York', paused: true, holdUntil: '2026-11-14T05:00:00+00:00' });
  assert.deepEqual(readScheduleRow(null, 'Europe/London'), { postTimes: ['18:00'], days: [1, 2, 3, 4, 5, 6, 7], timezone: 'Europe/London', paused: false, holdUntil: null });
});

test('a preset row falls back to the style defaults for anything odd', () => {
  assert.deepEqual(readPresetRow({ privacy: 'secret', category_id: 'x', made_for_kids: true, tags: ['a', 3] }, 'tall-tale'), {
    style: 'tall-tale', privacy: 'public', categoryId: '23', madeForKids: true, tags: ['a'],
  });
});

const row = {
  id: 'r1', job_id: null, video_path: 'u/j/video.mp4', cover_path: null, title: 'T', description: '', tags: ['x'], category_id: '24',
  privacy: 'unlisted', made_for_kids: false, position: -2, status: 'uploading', upload_url: 'https://upload/s', bytes_sent: '8388608',
  youtube_id: null, published_privacy: null, published_at: null, posted_by: 'manual', error: null, attempts: 1,
};

test('a queue row keeps a negative position and reads bigint byte counts', () => {
  const full = readQueueRow(row)!;
  assert.equal(full.position, -2);
  assert.equal(full.bytesSent, 8388608);
  assert.equal(full.uploadUrl, 'https://upload/s');
  assert.equal(full.postedBy, 'manual');
});

test('the screens never get the upload session, and a bad row reads as none', () => {
  assert.equal('uploadUrl' in readQueueItem(row)!, false);
  assert.equal(readQueueItem({ ...row, status: 'lost' }), null);
  assert.equal(readQueueItem({ ...row, privacy: 'secret' }), null);
});

test('readScheduleRow prefers the post_times list, sorted and each once, and falls back to post_time', () => {
  assert.deepEqual(readPostTimes(['20:00:00', '09:30:00', '20:00:00'], '18:00:00'), ['09:30', '20:00']);
  assert.deepEqual(readPostTimes(null, '07:15:00'), ['07:15']);
  assert.deepEqual(readPostTimes([], '07:15:00'), ['07:15']);
  assert.deepEqual(readPostTimes(['nonsense'], null), ['18:00']);
});
