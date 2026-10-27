import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { admittedUserIds, type AdmissionDb } from './admission.ts';

const before = process.env.ORBIS_ALLOWED_EMAILS;
afterEach(() => {
  if (before === undefined) delete process.env.ORBIS_ALLOWED_EMAILS;
  else process.env.ORBIS_ALLOWED_EMAILS = before;
});

/** An admin client whose accounts are `emails` by id; a missing id errors, 'throws' throws. */
function fakeAdmin(emails: Record<string, string | null>) {
  const looked: string[] = [];
  const admin: AdmissionDb = {
    auth: {
      admin: {
        async getUserById(userId) {
          looked.push(userId);
          if (userId === 'throws') throw new Error('network');
          if (!(userId in emails)) return { data: { user: null }, error: { message: 'User not found' } };
          return { data: { user: { email: emails[userId] } }, error: null };
        },
      },
    },
  };
  return { admin, looked };
}

test('with an allowlist, only listed accounts are admitted', async () => {
  process.env.ORBIS_ALLOWED_EMAILS = 'owner@example.com';
  const { admin } = fakeAdmin({ owner: 'Owner@Example.com', stranger: 'stranger@example.com', nomail: null });
  const ids = await admittedUserIds(admin, ['owner', 'stranger', 'nomail', 'missing', 'throws', 'owner']);
  assert.deepEqual([...ids], ['owner']);
});

test('with no allowlist everyone is admitted, as in the app, without a lookup', async () => {
  delete process.env.ORBIS_ALLOWED_EMAILS;
  const { admin, looked } = fakeAdmin({});
  const ids = await admittedUserIds(admin, ['a', 'b', 'a']);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
  assert.deepEqual(looked, []);
});

test('each account is looked up once, a few at a time', async () => {
  process.env.ORBIS_ALLOWED_EMAILS = 'u3@example.com';
  let inFlight = 0;
  let most = 0;
  const looked: string[] = [];
  const admin: AdmissionDb = {
    auth: {
      admin: {
        async getUserById(userId) {
          looked.push(userId);
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight -= 1;
          return { data: { user: { email: `${userId}@example.com` } }, error: null };
        },
      },
    },
  };
  const ids = Array.from({ length: 20 }, (_, i) => `u${i}`);
  assert.deepEqual([...(await admittedUserIds(admin, [...ids, ...ids]))], ['u3']);
  assert.equal(looked.length, 20);
  assert.ok(most <= 6, `ran ${most} at once`);
});
