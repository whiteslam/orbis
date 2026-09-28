import { test } from 'vitest';
import assert from 'node:assert/strict';
import { briefReady } from './brief-gate';

test('waits while weather is still loading', () => {
  assert.equal(briefReady({ weather: 'loading', portfolioSettled: true }), false);
});
test('waits for the portfolio to load or fail', () => {
  assert.equal(briefReady({ weather: 'ready', portfolioSettled: false }), false);
});
test('asks once weather has any final state and the portfolio has settled', () => {
  for (const weather of ['ready', 'error', 'needs-city', 'off'] as const) assert.equal(briefReady({ weather, portfolioSettled: true }), true);
});
