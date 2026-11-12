import { test } from 'vitest';
import assert from 'node:assert/strict';
import { scrubEvent } from './scrub.ts';

test('strips request body, cookies and query string', () => {
  const event = scrubEvent({
    message: 'boom',
    request: { url: 'https://orbis.example/active', method: 'POST', data: { email: 'a@b.c' }, cookies: { sb: 'token' }, query_string: 'code=secret', headers: { accept: 'text/html' } },
  });
  assert.equal(event.request?.data, undefined);
  assert.equal(event.request?.cookies, undefined);
  assert.equal(event.request?.query_string, undefined);
  assert.equal(event.request?.url, 'https://orbis.example/active');
  assert.equal(event.request?.method, 'POST');
  assert.equal(event.message, 'boom');
});

test('drops cookie and authorization headers whatever their case, keeps the rest', () => {
  const event = scrubEvent({
    request: { headers: { Cookie: 'a=b', AUTHORIZATION: 'Bearer x', 'user-agent': 'ua', 'X-Forwarded-For': '1.2.3.4' } },
  });
  assert.deepEqual(event.request?.headers, { 'user-agent': 'ua', 'X-Forwarded-For': '1.2.3.4' });
});

test('removes the query string from the url as well', () => {
  const event = scrubEvent({ request: { url: 'https://orbis.example/auth/callback?code=abc&state=x#frag' } });
  assert.equal(event.request?.url, 'https://orbis.example/auth/callback');
});

test('leaves events without a request alone, and does not mutate its input', () => {
  const bare = { message: 'hi' };
  assert.deepEqual(scrubEvent(bare), { message: 'hi' });
  const original = { request: { data: 'x', headers: { cookie: 'c' } } };
  scrubEvent(original);
  assert.equal(original.request.data, 'x');
  assert.equal(original.request.headers.cookie, 'c');
});
