import { test } from 'vitest';
import assert from 'node:assert/strict';
import { aiAllowed } from './consent';

test('AI is off until the person turns it on', () => {
  assert.equal(aiAllowed({ aiEnabled: false, aiConsentedAt: null }), false);
});
test('turning it on without the consent stamp is not enough', () => {
  assert.equal(aiAllowed({ aiEnabled: true, aiConsentedAt: null }), false);
});
test('on and consented means allowed; switching off stops it again', () => {
  assert.equal(aiAllowed({ aiEnabled: true, aiConsentedAt: '2026-09-28T10:00:00Z' }), true);
  assert.equal(aiAllowed({ aiEnabled: false, aiConsentedAt: '2026-09-28T10:00:00Z' }), false);
});
