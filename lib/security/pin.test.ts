import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, pinProblem, verifyPin } from './pin.ts';

test('a hashed PIN verifies only with the same digits', () => {
  const stored = hashPin('482915');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPin('482915', stored), true);
  assert.equal(verifyPin('482916', stored), false);
  assert.notEqual(hashPin('482915'), stored, 'each hash uses a fresh salt');
});

test('malformed stored hashes never verify', () => {
  assert.equal(verifyPin('482915', 'plain-text'), false);
  assert.equal(verifyPin('482915', 'scrypt$16384$8$1$abc$short'), false);
});

test('pinProblem rejects malformed and easy PINs', () => {
  for (const bad of ['12345', '1234567', 'abcdef', '', null, 123456]) assert.ok(pinProblem(bad), `expected rejection for ${String(bad)}`);
  for (const easy of ['000000', '777777', '123456', '654321', '890123', '121212', '123123', '909090']) assert.ok(pinProblem(easy), `expected rejection for ${easy}`);
  for (const good of ['482915', '731064', '205819']) assert.equal(pinProblem(good), null, `expected ${good} to be accepted`);
});
