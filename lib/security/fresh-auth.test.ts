import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canChangePassword } from './fresh-auth';

const now = 1_800_000_000;
test('a recovery sign-in within 15 minutes may change the password', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'recovery', timestamp: now - 60 }], nowSec: now, unlocked: false, currentPasswordVerified: false }), { ok: true });
});
test('an old recovery does not count', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'recovery', timestamp: now - 3600 }], nowSec: now, unlocked: true, currentPasswordVerified: false }), { ok: false, needs: 'current-password' });
});
test('a normal session needs the current password and an unlocked app', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'password', timestamp: now - 10 }], nowSec: now, unlocked: false, currentPasswordVerified: true }), { ok: false, needs: 'unlock' });
  assert.deepEqual(canChangePassword({ amr: [{ method: 'password', timestamp: now - 10 }], nowSec: now, unlocked: true, currentPasswordVerified: true }), { ok: true });
});
test('garbage amr is treated as not fresh', () => {
  assert.deepEqual(canChangePassword({ amr: 'x', nowSec: now, unlocked: true, currentPasswordVerified: false }), { ok: false, needs: 'current-password' });
});
test('a fresh one-time-code sign-in counts, a fresh password sign-in alone does not', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'otp', timestamp: now - 600 }], nowSec: now, unlocked: false, currentPasswordVerified: false }), { ok: true });
  assert.deepEqual(canChangePassword({ amr: [{ method: 'password', timestamp: now - 5 }], nowSec: now, unlocked: true, currentPasswordVerified: false }), { ok: false, needs: 'current-password' });
});
test('a recovery timestamp from the future is not fresh', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'recovery', timestamp: now + 600 }], nowSec: now, unlocked: false, currentPasswordVerified: false }), { ok: false, needs: 'unlock' });
});
