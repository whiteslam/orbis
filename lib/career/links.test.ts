import { test } from 'vitest';
import assert from 'node:assert/strict';
import { httpsHref, linkHost } from './links.ts';

test('only https links are clickable', () => {
  assert.equal(httpsHref('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(httpsHref('http://acme.io/apply'), null);
  assert.equal(httpsHref('javascript:alert(1)'), null);
  assert.equal(httpsHref('data:text/html,<script>1</script>'), null);
  assert.equal(httpsHref('//evil.example/x'), null);
  assert.equal(httpsHref(null), null);
  assert.equal(httpsHref(`https://a.io/${'x'.repeat(3000)}`), null);
});

test('the host shown beside a link is where it really goes', () => {
  assert.equal(linkHost('https://Meet.Google.com/abc'), 'meet.google.com');
  assert.equal(linkHost('https://zoom.us.evil.example/j/1'), 'zoom.us.evil.example');
  assert.equal(linkHost('http://acme.io/apply'), 'acme.io');
  assert.equal(linkHost('javascript:alert(1)'), null);
  assert.equal(linkHost('not a link'), null);
});
