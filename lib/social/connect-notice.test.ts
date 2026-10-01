import { test } from 'vitest';
import assert from 'node:assert/strict';
import { socialConnectNotice } from './connect-notice.ts';

test('a successful connection says so', () => {
  assert.deepEqual(socialConnectNotice('instagram-connected', null), { tone: 'success', text: 'Instagram connected.' });
  assert.deepEqual(socialConnectNotice('threads-connected', null), { tone: 'success', text: 'Threads connected.' });
});
test('on http, it explains that Meta needs an HTTPS address instead of silently doing nothing', () => {
  const notice = socialConnectNotice('instagram-needs-https', null);
  assert.equal(notice?.tone, 'error');
  assert.match(notice!.text, /HTTPS/);
  assert.match(notice!.text, /Instagram/);
});
test('missing keys name the settings to add', () => {
  assert.match(socialConnectNotice('instagram-not-configured', null)!.text, /META_APP_ID and META_APP_SECRET/);
  assert.match(socialConnectNotice('threads-not-configured', null)!.text, /THREADS_APP_ID and THREADS_APP_SECRET/);
});
test('a failure passes on Meta’s own reason when there is one', () => {
  assert.equal(socialConnectNotice('instagram-failed', 'Invalid Scopes: instagram_basic')!.text, 'Instagram could not be connected. Meta said: Invalid Scopes: instagram_basic');
  assert.equal(socialConnectNotice('threads-failed', null)!.text, 'Threads could not be connected. Try again.');
});
test('cancelling is not an error worth alarming about, but is still said', () => {
  assert.deepEqual(socialConnectNotice('threads-cancelled', null), { tone: 'info', text: 'Threads connection was cancelled.' });
});
test('anything unrecognised shows nothing rather than a made-up message', () => {
  assert.equal(socialConnectNotice('unknown', null), null);
  assert.equal(socialConnectNotice('facebook-connected', null), null);
  assert.equal(socialConnectNotice('<script>', null), null);
  assert.equal(socialConnectNotice(null, null), null);
});
test('the reason from the URL is cut short, since anyone can put text in a link', () => {
  assert.ok(socialConnectNotice('instagram-failed', 'x'.repeat(500))!.text.length < 220);
});
