import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasFreshAuth, signUnlockToken, verifyUnlockToken } from './unlock-token.ts';

const secret = 'test-secret-that-is-long-enough-for-hmac';
const userId = '5b0c1f3e-7a2d-4c1e-9f7a-1234567890ab';
const sessionId = '9e8d7c6b-5a4f-4e3d-8c2b-abcdefabcdef';
const now = 1_790_000_000;

test('a signed token verifies for the same user and session', () => {
  const token = signUnlockToken({ userId, sessionId, expiresAt: now + 300 }, secret);
  assert.equal(verifyUnlockToken(token, { userId, sessionId, nowSec: now }, secret), now + 300);
});

test('a tampered token is rejected', () => {
  const token = signUnlockToken({ userId, sessionId, expiresAt: now + 300 }, secret);
  const extended = token.replace(`.${now + 300}.`, `.${now + 99_999}.`);
  assert.equal(verifyUnlockToken(extended, { userId, sessionId, nowSec: now }, secret), null);
  assert.equal(verifyUnlockToken(`${token}x`, { userId, sessionId, nowSec: now }, secret), null);
  assert.equal(verifyUnlockToken(token, { userId, sessionId, nowSec: now }, 'another-secret'), null);
});

test('a token for another user or session is rejected', () => {
  const token = signUnlockToken({ userId, sessionId, expiresAt: now + 300 }, secret);
  assert.equal(verifyUnlockToken(token, { userId: sessionId, sessionId, nowSec: now }, secret), null);
  assert.equal(verifyUnlockToken(token, { userId, sessionId: userId, nowSec: now }, secret), null);
});

test('an expired or malformed token is rejected', () => {
  const token = signUnlockToken({ userId, sessionId, expiresAt: now }, secret);
  assert.equal(verifyUnlockToken(token, { userId, sessionId, nowSec: now }, secret), null);
  assert.equal(verifyUnlockToken(undefined, { userId, sessionId, nowSec: now }, secret), null);
  assert.equal(verifyUnlockToken('v1.a.b', { userId, sessionId, nowSec: now }, secret), null);
  assert.throws(() => signUnlockToken({ userId: 'bad.id', sessionId, expiresAt: now }, secret));
});

test('hasFreshAuth accepts only recent timestamped amr entries', () => {
  assert.equal(hasFreshAuth([{ method: 'password', timestamp: now - 10 }], now, 60), true);
  assert.equal(hasFreshAuth([{ method: 'passkey', timestamp: now - 59 }], now, 60), true);
  assert.equal(hasFreshAuth([{ method: 'password', timestamp: now - 61 }], now, 60), false);
  assert.equal(hasFreshAuth([{ method: 'password', timestamp: now - 3600 }, { method: 'webauthn', timestamp: now - 5 }], now, 60), true);
  assert.equal(hasFreshAuth([{ method: 'password', timestamp: now + 600 }], now, 60), false);
  assert.equal(hasFreshAuth(['password'], now, 60), false);
  assert.equal(hasFreshAuth(undefined, now, 60), false);
});
