import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isUuid } from './id';

test('accepts a real uuid and rejects look-alikes', () => {
  assert.equal(isUuid('3f2b8a4e-9c1d-4e7a-8b2f-1a2b3c4d5e6f'), true);
  assert.equal(isUuid('-'.repeat(36)), false);
  assert.equal(isUuid('3f2b8a4e9c1d4e7a8b2f1a2b3c4d5e6f'), false);
  assert.equal(isUuid(42), false);
});
