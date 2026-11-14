import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

import { signVideo } from './video-file.ts';

type Answer = { data: { path: string | null; signedUrl: string | null; error: string | null }[] | null; error: { message: string } | null };

function fakeAdmin(answer: () => Answer | Promise<Answer>) {
  const asked: { bucket: string; paths: string[] }[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => {
          asked.push({ bucket, paths });
          return answer();
        },
      }),
    },
  };
  return { admin: admin as unknown as Parameters<typeof signVideo>[0], asked };
}

const PATH = 'u1/job/video.mp4';

test('a signed video gives its address', async () => {
  const { admin, asked } = fakeAdmin(() => ({ data: [{ path: PATH, signedUrl: 'https://storage/v?token=t', error: null }], error: null }));
  assert.deepEqual(await signVideo(admin, PATH), { url: 'https://storage/v?token=t' });
  assert.deepEqual(asked, [{ bucket: 'shorts', paths: [PATH] }]);
});

test('an object storage says isn’t there is missing', async () => {
  const { admin } = fakeAdmin(() => ({ data: [{ path: PATH, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }], error: null }));
  assert.deepEqual(await signVideo(admin, PATH), { missing: true });
});

test('any other signing failure is a passing fault, not a missing file', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const whole = fakeAdmin(() => ({ data: null, error: { message: 'Internal Server Error' } }));
  assert.ok('failed' in (await signVideo(whole.admin, PATH)));
  const item = fakeAdmin(() => ({ data: [{ path: PATH, signedUrl: null, error: 'rate limited' }], error: null }));
  assert.ok('failed' in (await signVideo(item.admin, PATH)));
  const empty = fakeAdmin(() => ({ data: [], error: null }));
  assert.ok('failed' in (await signVideo(empty.admin, PATH)));
  const thrown = fakeAdmin(() => { throw new TypeError('fetch failed'); });
  assert.ok('failed' in (await signVideo(thrown.admin, PATH)));
  errors.mockRestore();
});
