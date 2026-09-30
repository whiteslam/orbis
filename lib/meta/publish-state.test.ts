import { test } from 'vitest';
import assert from 'node:assert/strict';
import { publishDecision } from './publish-state.ts';

const now = new Date('2026-09-30T10:00:00Z');
const row = (extra: Partial<Parameters<typeof publishDecision>[0]> = {}) => ({ containerId: 'c1', sentAt: null, createdAt: '2026-09-30T09:59:00Z', ...extra });

test('no container yet: wait while it is young, give up once it is old', () => {
  assert.equal(publishDecision(row({ containerId: null }), null, now), 'wait', 'another tab may be creating it right now');
  assert.equal(publishDecision(row({ containerId: null, createdAt: '2026-09-30T09:57:00Z' }), null, now), 'drop');
});

test('processing waits; finished publishes', () => {
  assert.equal(publishDecision(row(), 'IN_PROGRESS', now), 'wait');
  assert.equal(publishDecision(row(), 'FINISHED', now), 'publish');
});

test('once the publish call was sent, an unclear outcome is never dropped', () => {
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:59:30Z' }), 'PUBLISHED', now), 'recover');
  assert.equal(publishDecision(row({ sentAt: null }), 'PUBLISHED', now), 'recover', 'published by someone: find it, never publish again');
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:59:30Z' }), 'ERROR', now), 'keep', 'too soon to trust');
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:59:30Z' }), null, now), 'keep', 'status unknown');
  assert.equal(publishDecision(row({ sentAt: '2026-09-28T00:00:00Z', createdAt: '2026-09-28T00:00:00Z' }), null, now), 'keep', 'unknown stays kept, however old');
});

test('a sent container Meta still calls ERROR or EXPIRED ten minutes on never went out, so it is released', () => {
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:49:00Z', createdAt: '2026-09-30T09:48:00Z' }), 'ERROR', now), 'drop');
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:49:00Z', createdAt: '2026-09-30T09:48:00Z' }), 'EXPIRED', now), 'drop');
});

test('a failed container that was never sent is dropped so a retry is possible', () => {
  assert.equal(publishDecision(row(), 'ERROR', now), 'drop');
  assert.equal(publishDecision(row(), 'EXPIRED', now), 'drop');
  assert.equal(publishDecision(row({ createdAt: '2026-09-29T09:00:00Z' }), 'IN_PROGRESS', now), 'drop', 'unsent and over a day old');
});

test('a finished container whose publish call was sent a minute ago is retried; a fresh one waits', () => {
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:59:30Z' }), 'FINISHED', now), 'wait', 'the first call may still be landing');
  assert.equal(publishDecision(row({ sentAt: '2026-09-30T09:58:30Z' }), 'FINISHED', now), 'publish', 'FINISHED, not PUBLISHED: it did not go out');
});
