import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isBrandNewAccount } from './new-account.ts';

test('an account made and signed into seconds ago is brand new', () => {
  assert.equal(isBrandNewAccount('2026-11-12T10:00:00Z', '2026-11-12T10:00:01Z', new Date('2026-11-12T10:00:30Z')), true);
});

test('the same account minutes later is not', () => {
  assert.equal(isBrandNewAccount('2026-11-12T10:00:00Z', '2026-11-12T10:00:01Z', new Date('2026-11-12T10:05:00Z')), false);
});

test('an older account signing in again is not brand new', () => {
  assert.equal(isBrandNewAccount('2026-11-12T10:00:00Z', '2026-11-12T10:00:40Z', new Date('2026-11-12T10:00:45Z')), false);
});

test('missing or unreadable timestamps are never treated as brand new', () => {
  const now = new Date('2026-11-12T10:00:30Z');
  assert.equal(isBrandNewAccount(undefined, '2026-11-12T10:00:01Z', now), false);
  assert.equal(isBrandNewAccount('2026-11-12T10:00:00Z', undefined, now), false);
  assert.equal(isBrandNewAccount('nonsense', 'nonsense', now), false);
});

test('a created time in the future is not brand new', () => {
  assert.equal(isBrandNewAccount('2026-11-12T11:00:00Z', '2026-11-12T11:00:00Z', new Date('2026-11-12T10:00:00Z')), false);
});
