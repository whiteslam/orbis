import { test } from 'vitest';
import assert from 'node:assert/strict';
import { classifyMetaError, needsRefresh, parseLongToken, parseMe, parseShortToken, stripCode } from './tokens.ts';

test('the code loses the #_ Meta appends', () => {
  assert.equal(stripCode('AQBx#_'), 'AQBx');
  assert.equal(stripCode('AQBx'), 'AQBx');
});

test('the short token is read flat or wrapped, and user_id is ignored', () => {
  assert.equal(parseShortToken({ access_token: 'a', user_id: 17841405793187218 }), 'a');
  assert.equal(parseShortToken({ data: [{ access_token: 'b', user_id: 1, permissions: 'x' }] }), 'b');
  assert.equal(parseShortToken({ error: { message: 'no' } }), null);
  assert.equal(parseShortToken(null), null);
});

test('the long-lived token gets an expiry from expires_in', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  assert.deepEqual(parseLongToken({ access_token: 'L', token_type: 'bearer', expires_in: 5_184_000 }, now), { accessToken: 'L', expiresAt: '2026-11-29T00:00:00.000Z' });
  assert.equal(parseLongToken({ access_token: 'L' }, now), null, 'no expiry, no token');
});

test('me gives the account id as a string: Instagram user_id, Threads id', () => {
  assert.deepEqual(parseMe('instagram', { id: 'app-scoped', user_id: '17841405793187218', username: 'gaurav' }), { accountId: '17841405793187218', username: 'gaurav' });
  assert.deepEqual(parseMe('threads', { id: '25', username: 'g' }), { accountId: '25', username: 'g' });
  assert.equal(parseMe('instagram', { user_id: 17841405793187218, username: 'g' }), null, 'a number id would already be wrong');
  assert.equal(parseMe('threads', { id: '25' }), null);
});

test('refresh when fewer than seven days are left', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  assert.equal(needsRefresh('2026-10-06T23:59:00Z', now), true);
  assert.equal(needsRefresh('2026-10-07T00:01:00Z', now), false);
});

test('Meta errors: a bad token means reconnect, a 4xx is Meta’s reason, a 5xx is unavailable', () => {
  assert.equal(classifyMetaError(400, { error: { code: 190, message: 'Invalid OAuth access token' } }).kind, 'auth');
  assert.deepEqual(classifyMetaError(400, { error: { code: 9004, message: 'x', error_user_msg: 'The media could not be fetched.' } }), { kind: 'rejected', message: 'The media could not be fetched.' });
  assert.deepEqual(classifyMetaError(400, { error: { code: 100, message: 'Invalid parameter' } }), { kind: 'rejected', message: 'Invalid parameter' });
  assert.equal(classifyMetaError(503, {}).kind, 'unavailable');
  assert.equal(classifyMetaError(400, 'not json').kind, 'rejected');
});
