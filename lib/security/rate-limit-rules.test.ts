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
test('password checks allow five tries in fifteen minutes', () => {
  assert.deepEqual(limitFor('password'), { limit: 5, windowSeconds: 900 });
  assert.equal(rateLimitMessage('password'), 'Too many password attempts. Try again in 15 minutes.');
});
test('career buckets: AI and sends hourly, the manual search a few times an hour', () => {
  assert.deepEqual(limitFor('career_ai'), { limit: 60, windowSeconds: 3_600 });
  assert.deepEqual(limitFor('career_send'), { limit: 60, windowSeconds: 3_600 });
  assert.deepEqual(limitFor('career_search'), { limit: 6, windowSeconds: 3_600 });
  assert.match(rateLimitMessage('career_search'), /try again in an hour/i);
});
test('research runs: a dozen an hour at most', () => {
  assert.deepEqual(limitFor('research_run'), { limit: 12, windowSeconds: 3_600 });
  assert.match(rateLimitMessage('research_run'), /try again in an hour/i);
});
