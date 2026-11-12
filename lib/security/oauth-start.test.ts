import { test } from 'vitest';
import assert from 'node:assert/strict';
import { signFlowStart, verifyFlowStart } from './oauth-start.ts';

const SECRET = 'a'.repeat(43);
const NOW = 1_800_000_000;

test('a good cookie gives back when the flow began', () => {
  const value = signFlowStart(NOW, SECRET);
  assert.equal(verifyFlowStart(value, NOW + 60, SECRET)?.getTime(), NOW * 1000);
});

test('a tampered cookie is refused', () => {
  const value = signFlowStart(NOW, SECRET);
  const [v, , sig] = value.split('.');
  assert.equal(verifyFlowStart(`${v}.${NOW - 3_600}.${sig}`, NOW + 60, SECRET), null);
  assert.equal(verifyFlowStart(`${value}x`, NOW + 60, SECRET), null);
  assert.equal(verifyFlowStart('garbage', NOW + 60, SECRET), null);
  assert.equal(verifyFlowStart(undefined, NOW + 60, SECRET), null);
});

test('a cookie signed with another secret is refused', () => {
  assert.equal(verifyFlowStart(signFlowStart(NOW, 'b'.repeat(43)), NOW + 60, SECRET), null);
});

test('a cookie older than ten minutes is refused', () => {
  const value = signFlowStart(NOW, SECRET);
  assert.notEqual(verifyFlowStart(value, NOW + 600, SECRET), null);
  assert.equal(verifyFlowStart(value, NOW + 601, SECRET), null);
});

test('a start time in the future is refused', () => {
  assert.equal(verifyFlowStart(signFlowStart(NOW + 3_600, SECRET), NOW, SECRET), null);
});
