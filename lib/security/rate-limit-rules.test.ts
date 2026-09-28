import { test } from 'vitest';
import assert from 'node:assert/strict';
import { limitFor, rateLimitMessage } from './rate-limit-rules';

test('each bucket has a sane limit and window', () => {
  assert.deepEqual(limitFor('uploads'), { limit: 20, windowSeconds: 86_400 });
  assert.deepEqual(limitFor('parse'), { limit: 20, windowSeconds: 86_400 });
  assert.deepEqual(limitFor('sync'), { limit: 30, windowSeconds: 3_600 });
});
test('the message is plain and says when to try again', () => {
  assert.match(rateLimitMessage('sync'), /try again in an hour/i);
  assert.match(rateLimitMessage('uploads'), /tomorrow/i);
});
