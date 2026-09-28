import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAllowedPushEndpoint } from './push-endpoint';

test('real push services are allowed', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QK', 'https://wns2-par02p.notify.windows.com/w/?token=1']) assert.equal(isAllowedPushEndpoint(url), true, url);
});
test('anything else is refused', () => {
  for (const url of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/latest', 'not a url']) assert.equal(isAllowedPushEndpoint(url), false, url);
});
test('ports, user info and deeper Apple subdomains are refused, as in the database', () => {
  for (const url of ['https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'https://a.b.push.apple.com/x', 'https://FCM.googleapis.com/x']) assert.equal(isAllowedPushEndpoint(url), false, url);
  assert.equal(isAllowedPushEndpoint('https://api.push.apple.com/x'), true);
});
