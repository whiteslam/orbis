import { test } from 'vitest';
import assert from 'node:assert/strict';
import { skipsSessionRefresh } from './session-free';

test('the phone\u2019s own routes never refresh a session, whatever cookies ride along', () => {
  assert.equal(skipsSessionRefresh('/api/device/signals', null), true);
  assert.equal(skipsSessionRefresh('/api/device/signals', 'Device abc.def'), true);
  assert.equal(skipsSessionRefresh('/api/device/revoke', 'Device abc.def'), true);
});

test('a signed-in person removing a phone, and registering one, keep the session refresh', () => {
  // Cookie revoke from the web: no Device header.
  assert.equal(skipsSessionRefresh('/api/device/revoke', null), false);
  assert.equal(skipsSessionRefresh('/api/device/revoke', 'Bearer x'), false);
  assert.equal(skipsSessionRefresh('/api/device/revoke', 'device abc.def'), false);
  assert.equal(skipsSessionRefresh('/api/device/register', 'Device abc.def'), false);
});

test('nothing else is affected', () => {
  for (const path of ['/', '/active', '/api/device', '/api/device/signals/x', '/api/device/signalsx', '/api/account/export', '/x/api/device/signals']) {
    assert.equal(skipsSessionRefresh(path, 'Device abc.def'), false, path);
  }
});
