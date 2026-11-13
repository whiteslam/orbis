import { test } from 'vitest';
import assert from 'node:assert/strict';
import { accountAllowed } from './studio.ts';

test('only the owner may use the orbis account', () => {
  assert.equal(accountAllowed('orbis', 'owner'), true);
  assert.equal(accountAllowed('orbis', 'admin'), false);
  assert.equal(accountAllowed('orbis', 'user'), false);
  assert.equal(accountAllowed('me', 'user'), true);
});
