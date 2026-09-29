import { test } from 'vitest';
import assert from 'node:assert/strict';
import { HEARTBEAT_MS, heartbeatDue } from './lock-heartbeat';

const now = 1_800_000_000_000;

// Regression: a page load does not extend the server's unlock cookie, so the
// first activity after a load must, or a load late in the unlock window leaves
// the app on screen while every save is refused ("Sign in again…").
test('the first activity after the page loads sends a heartbeat', () => {
  assert.equal(heartbeatDue(null, now), true);
});

test('activity within a minute of the last heartbeat does not send another', () => {
  assert.equal(heartbeatDue(now - 1_000, now), false);
  assert.equal(heartbeatDue(now - HEARTBEAT_MS + 1, now), false);
});

test('activity a minute or more after the last heartbeat sends one', () => {
  assert.equal(heartbeatDue(now - HEARTBEAT_MS, now), true);
  assert.equal(heartbeatDue(now - 4 * HEARTBEAT_MS, now), true);
});
