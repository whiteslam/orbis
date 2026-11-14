import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

// retryQueueItemAction: Retry asks the old upload first, and never throws away an
// upload session it couldn't ask (it may already hold the whole video).

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({ settle: 'requeue' as string, retried: [] as string[] }));

vi.mock('@/lib/auth/session', () => ({ requireUser: async () => ({ userId: 'user-1', supabase: {} }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/youtube/publish', () => ({
  publishSlice: async () => 'none',
  settleFailedRow: async () => state.settle,
}));
vi.mock('@/lib/youtube/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/youtube/repository')>()),
  retryFailed: async (_admin: unknown, _user: string, id: string) => { state.retried.push(id); return true; },
  listQueue: async () => [],
}));

import { retryQueueItemAction } from '@/app/shorts/youtube-actions';

const ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => { state.settle = 'requeue'; state.retried = []; });

test('Retry requeues when the old upload had nothing', async () => {
  assert.deepEqual(await retryQueueItemAction(ID), { success: true, data: { queue: [], message: null } });
  assert.deepEqual(state.retried, [ID]);
});

test('Retry says so, and requeues nothing, when the old upload had already posted', async () => {
  state.settle = 'published';
  const result = await retryQueueItemAction(ID);
  assert.equal(result.success && result.data.message, 'It had already posted to YouTube, so it wasn’t uploaded again.');
  assert.deepEqual(state.retried, []);
});

test('Retry keeps the old upload when it can’t be asked', async () => {
  for (const settle of ['reconnect', 'unavailable']) {
    state.settle = settle;
    const result = await retryQueueItemAction(ID);
    assert.equal(result.success, false);
  }
  assert.deepEqual(state.retried, []);
});
