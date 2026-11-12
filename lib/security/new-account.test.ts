import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isNewAccount } from './new-account.ts';

const NOW = new Date('2026-11-12T10:30:00Z');
const FLOW = new Date('2026-11-12T10:29:00Z');

test('created after the flow began is new, however long the exchange took', () => {
  assert.equal(isNewAccount('2026-11-12T10:29:02Z', FLOW, NOW), true);
  assert.equal(isNewAccount('2026-11-12T10:28:56Z', FLOW, NOW), true); // within clock slack
});

test('created long before the flow began is an existing account', () => {
  assert.equal(isNewAccount('2026-11-10T10:00:00Z', FLOW, NOW), false);
  assert.equal(isNewAccount('2026-11-12T10:28:50Z', FLOW, NOW), false);
});

test('with no cookie, created minutes ago is new', () => {
  assert.equal(isNewAccount('2026-11-12T10:27:00Z', null, NOW), true);
});

test('with no cookie, created days ago is not new', () => {
  assert.equal(isNewAccount('2026-11-10T10:30:00Z', null, NOW), false);
});

test('a missing or unreadable created_at is treated as new', () => {
  assert.equal(isNewAccount(undefined, FLOW, NOW), true);
  assert.equal(isNewAccount('nonsense', null, NOW), true);
});
