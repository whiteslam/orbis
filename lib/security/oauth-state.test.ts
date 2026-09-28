import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OAUTH_STATE_MAX_AGE_SEC, signState, verifyState } from './oauth-state';

const secret = 'test-secret-that-is-long-enough-for-hmac';
const user = '11111111-2222-3333-4444-555555555555';
const other = '99999999-2222-3333-4444-555555555555';
const now = 1_800_000_000;

test('the state round-trips for the same user and purpose', () => {
  const { state, cookieValue } = signState(user, 'zerodha', secret, now);
  assert.equal(verifyState(cookieValue, state, user, 'zerodha', secret, now + 30), true);
});

test('a different user, purpose, state or secret is refused', () => {
  const { state, cookieValue } = signState(user, 'zerodha', secret, now);
  assert.equal(verifyState(cookieValue, state, other, 'zerodha', secret, now), false);
  assert.equal(verifyState(cookieValue, state, user, 'gmail', secret, now), false);
  assert.equal(verifyState(cookieValue, 'something-else', user, 'zerodha', secret, now), false);
  assert.equal(verifyState(cookieValue, state, user, 'zerodha', `${secret}x`, now), false);
  assert.equal(verifyState(cookieValue.replace(user, other), state, other, 'zerodha', secret, now), false);
});

test('a missing, malformed or expired state is refused', () => {
  const { state, cookieValue } = signState(user, 'zerodha', secret, now);
  assert.equal(verifyState(undefined, state, user, 'zerodha', secret, now), false);
  assert.equal(verifyState(cookieValue, null, user, 'zerodha', secret, now), false);
  assert.equal(verifyState('v1.a.b', state, user, 'zerodha', secret, now), false);
  assert.equal(verifyState(cookieValue, state, user, 'zerodha', secret, now + OAUTH_STATE_MAX_AGE_SEC), false);
});
