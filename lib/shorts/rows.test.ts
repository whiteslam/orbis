import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readEvent, readJob, readStyle, readWorker } from './rows';

const PLAN = {
  title: 'Gum', seconds: 30, sources: [],
  lines: [1, 2, 3].map((n) => ({ text: `Line ${n}.`, caps: `LINE *${n}`, shot: 'x' })),
};

const ROW = {
  id: '00000000-0000-4000-8000-000000000001', style: 'inside-out', topic: 'gum', status: 'plan_ready', stage: 'plan',
  options: { seconds: 30, voice: 'am_michael', mode: 'voice', music: 'bed', endLine: '' },
  plan: PLAN, plan_feedback: null, delivery: null, error: null, attempt: 1,
  created_at: '2026-11-10T08:00:00Z', started_at: null, finished_at: null, last_event_at: null,
};

test('a job row reads into a ShortJob', () => {
  const job = readJob(ROW);
  assert.ok(job);
  assert.equal(job.status, 'plan_ready');
  assert.equal(job.plan?.lines.length, 3);
  assert.equal(job.options.voice, 'am_michael');
});

test('a malformed plan or delivery is dropped, not trusted', () => {
  assert.equal(readJob({ ...ROW, plan: { title: 'x', lines: [] } })?.plan, null);
  assert.equal(readJob({ ...ROW, delivery: { title: 1 } })?.delivery, null);
});

test('a delivery reads with its files', () => {
  const delivery = { title: 'Gum', caption: 'c', hashtags: ['#a', 'b'], qa: ['fixed x'], seconds: 31.2, files: { video: 'u/j/short.mp4', share: null, cover: 'u/j/cover.jpg', sheet: null } };
  const job = readJob({ ...ROW, status: 'done', delivery });
  assert.equal(job?.delivery?.files.video, 'u/j/short.mp4');
  assert.deepEqual(job?.delivery?.hashtags, ['#a', '#b']);
});

test('an unknown status or a missing id is no job', () => {
  assert.equal(readJob({ ...ROW, status: 'weird' }), null);
  assert.equal(readJob({ ...ROW, id: null }), null);
  assert.equal(readJob(null), null);
});

test('events, styles and the worker read', () => {
  assert.deepEqual(readEvent({ seq: 2, kind: 'step', content: 'Recording the voice', at: 't' }), { seq: 2, kind: 'step', content: 'Recording the voice', at: 't' });
  assert.equal(readEvent({ seq: 2, kind: 'shout', content: 'x', at: 't' }), null);
  const style = readStyle({ slug: 'deep-dive', name: 'Deep Dive 3D', tagline: 't', best_for: 'b', seconds_min: 30, seconds_max: 45, is_3d: true, default_voice: 'am_michael', sheet_path: 'styles/deep-dive.png', example_title: 'E', position: 1 });
  assert.equal(style?.is3d, true);
  assert.equal(style?.secondsMax, 45);
  const worker = readWorker({ last_seen: 't', state: 'idle', note: null, voices: [{ id: 'am_michael', label: 'US male' }, { id: 'bad id' }] });
  assert.deepEqual(worker?.voices, [{ id: 'am_michael', label: 'US male' }]);
});
