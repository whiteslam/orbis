import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ANON_GLOBAL_KEY, ANON_UNKNOWN_KEY, anonRateKey, clientIpFrom } from './anon-rate-key';
import { anonLimitsFor } from './rate-limit-rules';

const secret = 'test-secret-that-is-long-enough-for-hmac';
const headers = (values: Record<string, string>) => new Headers(values);

test('the address is the first forwarded hop, then x-real-ip', () => {
  assert.equal(clientIpFrom(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assert.equal(clientIpFrom(headers({ 'x-real-ip': '2001:DB8::1' })), '2001:db8::1');
  assert.equal(clientIpFrom(headers({ 'x-forwarded-for': ' ', 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(clientIpFrom(headers({})), null);
  assert.equal(clientIpFrom(headers({ 'x-forwarded-for': 'not an ip' })), null);
});

test('the stored key is a keyed hash, never the address', () => {
  const key = anonRateKey('203.0.113.7', secret);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.ok(!key.includes('203'));
  assert.equal(anonRateKey('203.0.113.7', secret), key);
  assert.notEqual(anonRateKey('203.0.113.8', secret), key);
  assert.notEqual(anonRateKey('203.0.113.7', `${secret}x`), key);
  // Callers with no address share one budget rather than each getting a fresh one.
  assert.equal(anonRateKey(null, secret), ANON_UNKNOWN_KEY);
  assert.notEqual(ANON_UNKNOWN_KEY, ANON_GLOBAL_KEY);
});

test('the waitlist allows a few joins per address and a global cap per hour', () => {
  const { perAddress, global } = anonLimitsFor('waitlist');
  assert.deepEqual(perAddress, { limit: 5, windowSeconds: 3_600 });
  assert.equal(global.windowSeconds, 3_600);
  assert.ok(global.limit > perAddress.limit && global.limit <= 1_000);
});
