import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { QueueRowFull } from './rows.ts';
import type { Schedule } from './types.ts';
import type { UploadOutcome } from './upload.ts';

vi.mock('server-only', () => ({}));

const USER = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  schedule: null as unknown as Schedule,
  lastScheduled: null as string | null,
  queue: [] as { id: string; status: string }[],
  uploading: null as string | null,
  rows: new Map<string, unknown>(),
  takes: [] as { id: string; from: string; postedBy?: string }[],
  releases: [] as { id: string; patch: Record<string, unknown> }[],
  holds: [] as string[],
  refreshToken: 'refresh' as string | null,
  mint: null as null | (() => Promise<string>),
  marked: 0,
  recorded: 0,
  signed: 'yes' as 'yes' | 'missing' | 'failed',
  outcome: { kind: 'partial' } as unknown,
  uploads: [] as { bytesSent: number; uploadUrl: string | null }[],
  users: [] as string[],
  owner: '11111111-1111-4111-8111-111111111111',
  takenBy: new Map<string, string | undefined>(),
  failedScheduledAt: null as string | null,
  recordThrows: false,
  now: '',
  // settleFailedRow: the failed row it reads, and what it marked published.
  failedRow: null as unknown,
  settled: [] as { id: string; youtubeId: string; privacy: string }[],
  // Rows keep what each slice saved and released, as the database would.
  persist: false,
  scheduleReadFails: false,
  lastReadFails: false,
  // A strict read that failed, as the repository throws it.
  ReadError: class extends Error {},
}));

vi.mock('./repository.ts', () => ({
  YouTubeReadError: state.ReadError,
  // Lenient reads fall back to an unpaused default; strict ones throw (as the repository does).
  getSchedule: async (_admin: unknown, _user: string, opts?: { strict?: boolean }) => {
    if (!state.scheduleReadFails) return state.schedule;
    if (opts?.strict) throw new state.ReadError('youtube_settings couldn’t be read');
    return { ...state.schedule, paused: false };
  },
  // As the repository does: scheduled publishes and scheduled rows that failed for good, since local midnight.
  scheduledSince: async (_admin: unknown, _user: string, since: Date, opts?: { strict?: boolean }) => {
    if (state.lastReadFails) {
      if (opts?.strict) throw new state.ReadError('youtube_queue couldn’t be read');
      return 0;
    }
    return [state.lastScheduled, state.failedScheduledAt].filter((at): at is string => typeof at === 'string' && Date.parse(at) >= since.getTime()).length;
  },
  listQueue: async () => state.queue,
  uploadingRowId: async () => state.uploading,
  takeRow: async (_admin: unknown, user: string, id: string, from: string, postedBy?: string) => {
    state.takes.push({ id, from, postedBy });
    const row = state.rows.get(id) as QueueRowFull | undefined;
    // Like the SQL: only a row in the expected status is taken, and starting it records who posted it.
    if (!row || row.status !== from) return null;
    if (from === 'queued') state.takenBy.set(id, postedBy);
    if (state.persist) state.rows.set(id, { ...row, status: 'uploading' });
    // Each person's copy of a shared test row sits in their own folder, unless the test placed it elsewhere.
    return { ...row, status: 'uploading', videoPath: row.videoPath.replace(state.owner, user) };
  },
  release: async (_admin: unknown, id: string, patch: Record<string, unknown>) => {
    state.releases.push({ id, patch });
    if (state.persist) state.rows.set(id, { ...(state.rows.get(id) as QueueRowFull), ...rowPatch(patch) });
    if (patch.status === 'failed' && state.takenBy.get(id) === 'schedule') state.failedScheduledAt = state.now;
  },
  saveUpload: async (_admin: unknown, id: string, progress: { uploadUrl?: string | null; bytesSent?: number }) => {
    if (state.persist) state.rows.set(id, { ...(state.rows.get(id) as QueueRowFull), ...progress });
  },
  setHold: async (_admin: unknown, _user: string, iso: string) => { state.holds.push(iso); },
  usersWithWork: async () => state.users,
  failedRow: async (_admin: unknown, _user: string, id: string) => {
    const row = state.failedRow as QueueRowFull | null;
    return row && row.id === id ? row : null;
  },
  settlePublished: async (_admin: unknown, _user: string, id: string, done: { youtubeId: string; privacy: string }) => {
    state.settled.push({ id, ...done });
    return true;
  },
}));

vi.mock('./connection.ts', () => ({
  getYouTubeRefreshToken: async () => state.refreshToken,
  markYouTubeReconnect: async () => { state.marked += 1; },
  recordYouTubePublish: async () => {
    if (state.recordThrows) throw new Error('social_connections went away');
    state.recorded += 1;
  },
}));

vi.mock('./google.ts', async () => {
  const actual = await vi.importActual<typeof import('./google.ts')>('./google.ts');
  return { ...actual, mintAccessToken: async () => (state.mint ? state.mint() : 'access') };
});

vi.mock('./video-file.ts', () => ({
  signVideo: async (_admin: unknown, path: string) => {
    if (state.signed === 'missing') return { missing: true };
    if (state.signed === 'failed') return { failed: 'storage said 500' };
    return { url: `https://storage/${path}?token=t` };
  },
}));

vi.mock('./upload.ts', async () => {
  const actual = await vi.importActual<typeof import('./upload.ts')>('./upload.ts');
  return {
    ...actual,
    runUpload: async (...args: Parameters<typeof actual.runUpload>) => {
      const [row] = args;
      state.uploads.push({ bytesSent: row.bytesSent, uploadUrl: row.uploadUrl });
      if (state.outcome === 'throw') throw new Error('database went away');
      // The real protocol, over whatever fetch the test stubbed.
      if (state.outcome === 'real') return actual.runUpload(...args);
      return state.outcome as UploadOutcome;
    },
  };
});

/** The columns a release patch names, as the row reader names them. */
function rowPatch(patch: Record<string, unknown>): Partial<QueueRowFull> {
  const names: Record<string, keyof QueueRowFull> = { status: 'status', attempts: 'attempts', error: 'error', upload_url: 'uploadUrl', bytes_sent: 'bytesSent', youtube_id: 'youtubeId' };
  return Object.fromEntries(Object.entries(patch).flatMap(([key, value]) => (names[key] ? [[names[key], value]] : [])));
}

import { YouTubeAuthError } from './google.ts';
import { publishDue, publishSlice, settleFailedRow } from './publish.ts';

type Admin = Parameters<typeof publishSlice>[0];
const admin = {} as Admin;

// Friday 2026-11-13, 19:00 in Kolkata: after the 18:00 post time.
const NOW = new Date('2026-11-13T13:30:00Z');
const later = () => Date.now() + 45_000;

const queueRow = (over: Partial<QueueRowFull> = {}): QueueRowFull => ({
  id: 'row-1',
  jobId: null,
  videoPath: `${USER}/job/video.mp4`,
  coverPath: null,
  title: 'A tall tale',
  description: '',
  tags: [],
  categoryId: '23',
  privacy: 'public',
  madeForKids: false,
  position: 1,
  status: 'queued',
  bytesSent: 0,
  uploadUrl: null,
  youtubeId: null,
  publishedPrivacy: null,
  publishedAt: null,
  postedBy: 'schedule',
  error: null,
  attempts: 0,
  ...over,
});

beforeEach(() => {
  state.schedule = { postTimes: ['18:00'], days: [1, 2, 3, 4, 5, 6, 7], timezone: 'Asia/Kolkata', paused: false, holdUntil: null };
  state.lastScheduled = null;
  state.queue = [];
  state.uploading = null;
  state.rows = new Map();
  state.takes = [];
  state.releases = [];
  state.holds = [];
  state.refreshToken = 'refresh';
  state.mint = null;
  state.marked = 0;
  state.recorded = 0;
  state.signed = 'yes';
  state.outcome = { kind: 'partial' };
  state.uploads = [];
  state.users = [];
  state.takenBy = new Map();
  state.failedScheduledAt = null;
  state.recordThrows = false;
  state.now = NOW.toISOString();
  state.failedRow = null;
  state.settled = [];
  state.persist = false;
  state.scheduleReadFails = false;
  state.lastReadFails = false;
  vi.unstubAllGlobals();
});

test('not due and nothing uploading does nothing', async () => {
  state.schedule.postTimes = ['20:00'];
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'none');
  assert.deepEqual(state.takes, []);
  assert.deepEqual(state.releases, []);
});

test('a due schedule takes the first queued row', async () => {
  state.queue = [{ id: 'row-0', status: 'uploading' }, { id: 'row-1', status: 'queued' }, { id: 'row-2', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'partial');
  assert.deepEqual(state.takes, [{ id: 'row-1', from: 'queued', postedBy: 'schedule' }]);
});

test('an uploading row is resumed even when not due', async () => {
  state.schedule.paused = true;
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8 }));
  state.outcome = { kind: 'done', youtubeId: 'yt1', privacy: 'public' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'published');
  assert.deepEqual(state.takes, [{ id: 'row-1', from: 'uploading', postedBy: undefined }]);
  assert.deepEqual(state.uploads, [{ bytesSent: 8, uploadUrl: 'https://upload/session' }]);
  const { patch } = state.releases[0];
  assert.equal(patch.status, 'published');
  assert.equal(patch.youtube_id, 'yt1');
  assert.equal(patch.published_privacy, 'public');
  assert.equal(typeof patch.published_at, 'string');
  assert.equal(state.recorded, 1);
});

test('a manual post takes the chosen row and skips the due check', async () => {
  state.schedule.paused = true;
  state.rows.set('row-9', queueRow({ id: 'row-9' }));
  assert.equal(await publishSlice(admin, USER, { rowId: 'row-9', postedBy: 'manual', deadline: later(), now: NOW }), 'partial');
  assert.deepEqual(state.takes, [{ id: 'row-9', from: 'queued', postedBy: 'manual' }]);
  assert.deepEqual(state.releases[0].patch, {});
});

test('a row someone else holds is left alone', async () => {
  // takeRow finds the lease taken and gives nothing back.
  assert.equal(await publishSlice(admin, USER, { rowId: 'row-9', postedBy: 'manual', deadline: later(), now: NOW }), 'none');
  assert.deepEqual(state.releases, []);
});

test('quota sets hold_until to the next local day and keeps the row queued', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow({ uploadUrl: 'https://upload/session' }));
  state.outcome = { kind: 'quota' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'held');
  // Midnight starting Saturday 14 November in Kolkata.
  assert.deepEqual(state.holds, ['2026-11-13T18:30:00.000Z']);
  const { patch } = state.releases[0];
  assert.equal(patch.status, 'queued');
  assert.equal(patch.error, 'YouTube’s daily upload limit was reached. Trying again on the next posting day.');
  assert.equal(patch.upload_url, null);
  assert.equal(patch.bytes_sent, 0);
  assert.equal('position' in patch, false);
});

test('the third error fails the row', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.outcome = { kind: 'error', message: 'YouTube said 500: busy' };

  state.rows.set('row-1', queueRow({ attempts: 1 }));
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  assert.deepEqual(state.releases[0].patch, { status: 'queued', attempts: 2, error: 'YouTube said 500: busy', upload_url: null, bytes_sent: 0 });

  state.rows.set('row-1', queueRow({ attempts: 2 }));
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  assert.deepEqual(state.releases[1].patch, { status: 'failed', attempts: 3, error: 'YouTube said 500: busy', upload_url: null, bytes_sent: 0 });
});

test('a missing file fails the row at once', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.outcome = { kind: 'missing' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  assert.equal(state.releases[0].patch.status, 'failed');
  assert.equal(state.releases[0].patch.error, 'video file missing');
});

test('a video outside the person’s own folder is never signed or sent', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow({ videoPath: 'someone-else/job/video.mp4' }));
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  assert.deepEqual(state.uploads, []);
  assert.equal(state.releases[0].patch.error, 'video file missing');
});

test('invalid_grant marks reconnect and leaves the row queued', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.mint = async () => { throw new YouTubeAuthError('Google stopped accepting Orbis’s access. Connect again.', true); };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'reconnect');
  assert.equal(state.marked, 1);
  assert.deepEqual(state.uploads, []);
  assert.deepEqual(state.releases[0].patch, { status: 'queued', upload_url: null, bytes_sent: 0 });
});

test('no refresh token marks reconnect too', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.refreshToken = null;
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'reconnect');
  assert.equal(state.marked, 1);
  assert.equal(state.releases[0].patch.status, 'queued');
});

test('a 401 halfway through keeps the row uploading', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8 }));
  state.outcome = { kind: 'reconnect' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'reconnect');
  assert.equal(state.marked, 1);
  assert.deepEqual(state.releases[0].patch, {});
});

test('Google being down uses an attempt, and the last one fails the row', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.mint = async () => { throw new TypeError('fetch failed'); };
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

  state.rows.set('row-1', queueRow({ attempts: 1 }));
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  assert.equal(state.marked, 0);
  assert.deepEqual(state.releases[0].patch, { status: 'queued', attempts: 2, error: 'Google couldn’t be reached to sign in.', upload_url: null, bytes_sent: 0 });

  state.mint = async () => { throw new YouTubeAuthError('Google could not complete the YouTube sign-in. Try again.'); };
  state.rows.set('row-1', queueRow({ attempts: 2 }));
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  assert.deepEqual(state.releases[1].patch, { status: 'failed', attempts: 3, error: 'Google could not complete the YouTube sign-in. Try again.', upload_url: null, bytes_sent: 0 });
  // Logged by message only: no error object that could carry a request.
  assert.ok(errors.mock.calls.length > 0);
  assert.ok(errors.mock.calls.every((args) => args.every((arg) => typeof arg === 'string')));
  errors.mockRestore();
});

test('a video that won’t sign uses an attempt instead of failing at once', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.signed = 'failed';
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  assert.deepEqual(state.uploads, []);
  assert.deepEqual(state.releases[0].patch, { status: 'queued', attempts: 1, error: 'The video file couldn’t be opened for upload.', upload_url: null, bytes_sent: 0 });
});

test('after the third error, the next slice the same day does nothing', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }, { id: 'row-2', status: 'queued' }];
  state.rows.set('row-1', queueRow({ attempts: 2 }));
  state.rows.set('row-2', queueRow({ id: 'row-2' }));
  state.outcome = { kind: 'error', message: 'YouTube said 500: busy' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  state.queue = [{ id: 'row-2', status: 'queued' }];
  const tenMinutesOn = new Date(NOW.getTime() + 10 * 60_000);
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: tenMinutesOn }), 'none');
  assert.deepEqual(state.takes.map((take) => take.id), ['row-1']);
});

test('Post now on one row while another is uploading works on the chosen row', async () => {
  state.uploading = 'row-y';
  state.rows.set('row-y', queueRow({ id: 'row-y', status: 'uploading', uploadUrl: 'https://upload/y', bytesSent: 8 }));
  state.rows.set('row-x', queueRow({ id: 'row-x' }));
  assert.equal(await publishSlice(admin, USER, { rowId: 'row-x', postedBy: 'manual', deadline: later(), now: NOW }), 'partial');
  assert.deepEqual(state.takes, [{ id: 'row-x', from: 'queued', postedBy: 'manual' }]);
  assert.deepEqual(state.releases.map((one) => one.id), ['row-x']);
});

test('Post now on a row already uploading resumes it', async () => {
  state.rows.set('row-x', queueRow({ id: 'row-x', status: 'uploading', uploadUrl: 'https://upload/x', bytesSent: 8 }));
  state.outcome = { kind: 'done', youtubeId: 'yt-x', privacy: 'public' };
  assert.equal(await publishSlice(admin, USER, { rowId: 'row-x', postedBy: 'manual', deadline: later(), now: NOW }), 'published');
  assert.deepEqual(state.takes, [{ id: 'row-x', from: 'queued', postedBy: 'manual' }, { id: 'row-x', from: 'uploading', postedBy: undefined }]);
  assert.deepEqual(state.uploads, [{ bytesSent: 8, uploadUrl: 'https://upload/x' }]);
});

test('a published video stays published when recording the time fails', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8 }));
  state.outcome = { kind: 'done', youtubeId: 'yt1', privacy: 'public' };
  state.recordThrows = true;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'published');
  assert.equal(state.releases[0].patch.status, 'published');
  errors.mockRestore();
});

test('a thrown error still releases the lease', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8 }));
  state.outcome = 'throw';
  await assert.rejects(publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }));
  assert.deepEqual(state.releases, [{ id: 'row-1', patch: {} }]);
});

test('one person’s failure doesn’t stop the run for the next', async () => {
  state.users = [USER, '22222222-2222-4222-8222-222222222222'];
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8 }));
  state.outcome = 'throw';
  const counts = await publishDue(admin, NOW, later());
  assert.equal(state.releases.length, 2);
  assert.deepEqual(counts, { users: 0, published: 0, partial: 0, errors: 2 });
});

test('publishDue counts what each person’s slice did', async () => {
  state.users = [USER, '22222222-2222-4222-8222-222222222222'];
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.outcome = { kind: 'done', youtubeId: 'yt1', privacy: 'public' };
  const counts = await publishDue(admin, NOW, later());
  assert.deepEqual(counts, { users: 2, published: 2, partial: 0, errors: 0 });
});

test('publishDue with nobody to serve does nothing', async () => {
  assert.deepEqual(await publishDue(admin, NOW, later()), { users: 0, published: 0, partial: 0, errors: 0 });
});

// Finding 1: the final chunk lands but its answer is lost. The next slice must
// ask the same session what it has, and never open a second one.
test('a lost answer to the final chunk is published once, from the same session', async () => {
  state.persist = true;
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.outcome = 'real';
  const video = new Uint8Array(1000).fill(7);
  const calls: { method: string; range: string | null; body: boolean }[] = [];
  let lostOnce = false;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    if (url.startsWith('https://storage/')) {
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(headers.get('range') ?? '')!.map(Number);
      return new Response(video.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${video.length}` } });
    }
    calls.push({ method: init.method ?? 'GET', range: headers.get('content-range'), body: init.body !== undefined });
    if (init.method === 'POST') return new Response(null, { status: 200, headers: { location: 'https://upload/session-1' } });
    if (headers.get('content-range') === 'bytes 0-999/1000') {
      // YouTube got every byte, but the answer never arrived.
      lostOnce = true;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    if (headers.get('content-range') === 'bytes */1000' && lostOnce) {
      return Response.json({ id: 'yt-once', status: { privacyStatus: 'public' } }, { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  });

  // The first slice: the session opens, every byte goes, the answer is lost.
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  const kept = state.rows.get('row-1') as QueueRowFull;
  assert.equal(kept.status, 'uploading');
  assert.equal(kept.uploadUrl, 'https://upload/session-1');
  assert.equal(kept.attempts, 1);
  assert.match(String(kept.error), /Couldn’t reach YouTube/);
  assert.equal('upload_url' in state.releases[0].patch, false);

  // The next cron run finishes the row first (R4) and asks the session what it has.
  state.uploading = 'row-1';
  state.queue = [];
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'published');
  assert.equal(state.releases[1].patch.youtube_id, 'yt-once');
  assert.equal(state.recorded, 1);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.range ?? ''}`.trim()), ['POST', 'PUT bytes 0-999/1000', 'PUT bytes */1000']);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});

test('an error once a session exists keeps the session and the row uploading', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8, attempts: 0 }));
  state.outcome = { kind: 'error', message: 'Couldn’t reach YouTube: timed out' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  assert.deepEqual(state.releases[0].patch, { status: 'uploading', attempts: 1, error: 'Couldn’t reach YouTube: timed out' });
});

test('Google down on a resumed upload keeps its session too', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8, attempts: 1 }));
  state.mint = async () => { throw new TypeError('fetch failed'); };
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'retry');
  assert.deepEqual(state.releases[0].patch, { status: 'uploading', attempts: 2, error: 'Google couldn’t be reached to sign in.' });
  errors.mockRestore();
});

test('a row failing its last attempt keeps its upload session', async () => {
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 8, attempts: 2 }));
  state.outcome = { kind: 'error', message: 'YouTube said 500: busy' };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  // Retry asks this session first: YouTube may already have the whole video.
  assert.deepEqual(state.releases[0].patch, { status: 'failed', attempts: 3, error: 'YouTube said 500: busy' });
});

// A fetch for settleFailedRow: storage answers the size, YouTube's session answers `session`.
function settleFetch(session: () => Response) {
  const calls: { url: string; method: string; range: string | null; body: boolean }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? 'GET', range: headers.get('content-range'), body: init.body !== undefined && init.body !== null });
    if (url.startsWith('https://storage/')) return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/1000' } });
    return session();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const failedWithSession = () => queueRow({ status: 'failed', uploadUrl: 'https://upload/session', bytesSent: 1000, attempts: 3, error: 'Couldn’t reach YouTube' });
const answer308 = () => new Response(null, { status: 308, headers: { range: 'bytes=0-499' } });
const answer503 = () => new Response('busy', { status: 503 });
const noAnswer = (): Response => { throw new TypeError('fetch failed'); };

test('settling a failed row whose session finished marks it published and never uploads', async () => {
  state.failedRow = failedWithSession();
  const { fetchImpl, calls } = settleFetch(() => Response.json({ id: 'yt-1', status: { privacyStatus: 'unlisted' } }, { status: 200 }));
  assert.equal(await settleFailedRow(admin, USER, 'row-1', { fetch: fetchImpl }), 'published');
  assert.deepEqual(state.settled, [{ id: 'row-1', youtubeId: 'yt-1', privacy: 'unlisted' }]);
  assert.equal(state.recorded, 1);
  const youtube = calls.filter((call) => !call.url.startsWith('https://storage/'));
  assert.deepEqual(youtube.map((call) => `${call.method} ${call.range}`), ['PUT bytes */1000']);
  assert.equal(youtube.some((call) => call.body), false);
});

test('settling a failed row whose session is unfinished asks to requeue and changes nothing', async () => {
  // 308 (part sent), 503 (YouTube busy) and no answer at all: none of them say it posted.
  for (const session of [answer308, answer503, noAnswer]) {
    state.failedRow = failedWithSession();
    const { fetchImpl } = settleFetch(session);
    assert.equal(await settleFailedRow(admin, USER, 'row-1', { fetch: fetchImpl }), 'requeue');
  }
  assert.deepEqual(state.settled, []);
  assert.equal(state.recorded, 0);
});

test('settling a failed row without a session asks to requeue without calling anyone', async () => {
  state.failedRow = queueRow({ status: 'failed', attempts: 3 });
  const { fetchImpl, calls } = settleFetch(answer503);
  assert.equal(await settleFailedRow(admin, USER, 'row-1', { fetch: fetchImpl }), 'requeue');
  assert.equal(calls.length, 0);
});

test('settling when Google refuses the token asks to requeue', async () => {
  state.failedRow = failedWithSession();
  state.mint = async () => { throw new YouTubeAuthError('Google stopped accepting Orbis’s access. Connect again.', true); };
  const { fetchImpl, calls } = settleFetch(() => Response.json({ id: 'yt-1' }, { status: 200 }));
  assert.equal(await settleFailedRow(admin, USER, 'row-1', { fetch: fetchImpl }), 'requeue');
  assert.equal(calls.length, 0);
  assert.deepEqual(state.settled, []);
});

test('an uploading row that holds an error is still picked by Post now', async () => {
  state.rows.set('row-x', queueRow({ id: 'row-x', status: 'uploading', uploadUrl: 'https://upload/x', bytesSent: 8, attempts: 1, error: 'Couldn’t reach YouTube: timed out' }));
  state.outcome = { kind: 'done', youtubeId: 'yt-x', privacy: 'public' };
  assert.equal(await publishSlice(admin, USER, { rowId: 'row-x', postedBy: 'manual', deadline: later(), now: NOW }), 'published');
  assert.equal(state.releases[0].patch.error, null);
});

// Finding 2: the publisher never posts on a guess.
test('a settings read error while paused posts nothing', async () => {
  state.schedule.paused = true;
  state.scheduleReadFails = true;
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'none');
  assert.deepEqual(state.takes, []);
  errors.mockRestore();
});

test('a failed read of the last scheduled post posts nothing', async () => {
  state.lastReadFails = true;
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'none');
  assert.deepEqual(state.takes, []);
  errors.mockRestore();
});

// Minor 1: a video that isn't in storage at all fails at once.
test('a video that isn’t in storage fails the row at once', async () => {
  state.queue = [{ id: 'row-1', status: 'queued' }];
  state.rows.set('row-1', queueRow());
  state.signed = 'missing';
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'failed');
  assert.deepEqual(state.uploads, []);
  assert.deepEqual(state.releases[0].patch, { status: 'failed', error: 'video file missing', upload_url: null, bytes_sent: 0 });
});

test('a reconnect on a row whose session may already hold the video keeps that session', async () => {
  // A one-chunk video: the chunk went, its answer was lost, so bytes_sent is still 0.
  state.uploading = 'row-1';
  state.rows.set('row-1', queueRow({ status: 'uploading', uploadUrl: 'https://upload/session', bytesSent: 0, attempts: 1 }));
  state.mint = async () => { throw new YouTubeAuthError('Google stopped accepting Orbis’s access. Connect again.', true); };
  assert.equal(await publishSlice(admin, USER, { postedBy: 'schedule', deadline: later(), now: NOW }), 'reconnect');
  assert.deepEqual(state.releases[0].patch, {});
});
