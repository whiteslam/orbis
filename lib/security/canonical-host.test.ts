import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canonicalStartUrl } from './canonical-host.ts';

test('a start on another host is sent to the same route on the canonical host, query kept', () => {
  assert.equal(
    canonicalStartUrl('http://127.0.0.1:3000/auth/gmail/start?return=settings', 'http://localhost:3000'),
    'http://localhost:3000/auth/gmail/start?return=settings&hop=1',
  );
  assert.equal(
    canonicalStartUrl('http://172.20.10.2:3000/auth/zerodha/start', 'https://orbis.example.com'),
    'https://orbis.example.com/auth/zerodha/start?hop=1',
  );
});

test('the browser\'s Host wins over a request.url the dev server rewrote to localhost', () => {
  assert.equal(
    canonicalStartUrl('http://localhost:3000/auth/gmail/start', 'http://localhost:3000', '172.20.10.2:3000'),
    'http://localhost:3000/auth/gmail/start?hop=1',
  );
  assert.equal(canonicalStartUrl('http://localhost:3000/auth/gmail/start', 'http://localhost:3000', 'localhost:3000'), null);
});

test('a start already on the canonical host stays put', () => {
  assert.equal(canonicalStartUrl('http://localhost:3000/auth/gmail/start', 'http://localhost:3000'), null);
});

test('a TLS-terminating proxy reporting http for an https site does not bounce', () => {
  assert.equal(canonicalStartUrl('http://orbis.example.com/auth/social/threads/start', 'https://orbis.example.com'), null);
});

test('one bounce at most, even if the hosts still disagree', () => {
  assert.equal(canonicalStartUrl('http://127.0.0.1:3000/auth/gmail/start?hop=1', 'http://localhost:3000'), null);
});

test('an unreadable canonical origin leaves the request alone', () => {
  assert.equal(canonicalStartUrl('http://localhost:3000/auth/gmail/start', 'not a url'), null);
});
