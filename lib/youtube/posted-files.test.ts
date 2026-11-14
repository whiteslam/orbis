import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

import { postedFilePaths, removePostedFiles, youtubeThumbnail } from './posted-files.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const own = (name: string) => `${USER}/${JOB}/${name}`;

test('a posted short’s files are its queued video and cover plus every file the build made, each once', () => {
  const delivery = { files: { video: own('short.mp4'), share: own('share.mp4'), cover: own('cover.jpg'), sheet: own('sheet.jpg') } };
  assert.deepEqual(
    postedFilePaths(USER, { videoPath: own('short.mp4'), coverPath: own('cover.jpg') }, delivery).sort(),
    [own('cover.jpg'), own('share.mp4'), own('sheet.jpg'), own('short.mp4')],
  );
});

test('only files in the person’s own folder are ever named', () => {
  const delivery = { files: { video: `someone-else/${JOB}/short.mp4`, share: null, cover: `${USER}/../x.jpg`, sheet: 'styles/cozy-tales.png' } };
  assert.deepEqual(postedFilePaths(USER, { videoPath: own('short.mp4'), coverPath: null }, delivery), [own('short.mp4')]);
  assert.deepEqual(postedFilePaths(USER, { videoPath: 'styles/cozy-tales.png', coverPath: null }, null), []);
});

// A fake admin: shorts_jobs holds one job's delivery; storage records what was removed.
function fakeAdmin(opts: { delivery?: unknown; removeError?: boolean } = {}) {
  const removed: string[][] = [];
  const admin = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: opts.delivery === undefined ? null : { delivery: opts.delivery }, error: null }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return opts.removeError ? { data: null, error: { message: 'storage down' } } : { data: [], error: null };
        },
      }),
    },
  };
  return { admin: admin as unknown as Parameters<typeof removePostedFiles>[0], removed };
}

test('removing a posted short’s files takes the build’s files too, and keeps every detail', async () => {
  const { admin, removed } = fakeAdmin({ delivery: { files: { video: own('short.mp4'), share: own('share.mp4'), cover: own('cover.jpg'), sheet: own('sheet.jpg') } } });
  assert.equal(await removePostedFiles(admin, USER, { jobId: JOB, videoPath: own('short.mp4'), coverPath: own('cover.jpg') }), true);
  assert.equal(removed.length, 1);
  assert.deepEqual(removed[0].sort(), [own('cover.jpg'), own('share.mp4'), own('sheet.jpg'), own('short.mp4')]);
});

test('a short with no job (imported) loses only its queued files', async () => {
  const { admin, removed } = fakeAdmin();
  await removePostedFiles(admin, USER, { jobId: null, videoPath: `${USER}/imported/a.mp4`, coverPath: null });
  assert.deepEqual(removed, [[`${USER}/imported/a.mp4`]]);
});

test('a storage failure is reported, never thrown', async () => {
  const { admin } = fakeAdmin({ removeError: true });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(await removePostedFiles(admin, USER, { jobId: null, videoPath: own('short.mp4'), coverPath: null }), false);
  errors.mockRestore();
});

test('YouTube’s own thumbnail stands in for the removed cover', () => {
  assert.equal(youtubeThumbnail('abc_123-XY'), 'https://i.ytimg.com/vi/abc_123-XY/hqdefault.jpg');
  assert.equal(youtubeThumbnail('bad/id'), null);
  assert.equal(youtubeThumbnail(null), null);
});
