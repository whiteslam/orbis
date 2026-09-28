import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { UserFacingError, userMessage } from './errors';

test('a user-facing error keeps its message', () => {
  assert.equal(userMessage(new UserFacingError('This file is empty.'), 'Fallback.'), 'This file is empty.');
});
test('anything else is logged and replaced with the fallback', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  assert.equal(userMessage(new Error('relation "x" does not exist'), 'Fallback.'), 'Fallback.');
  assert.equal(userMessage('boom', 'Fallback.'), 'Fallback.');
  assert.equal(log.mock.calls.length, 2);
  log.mockRestore();
});
