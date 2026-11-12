import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SENTRY_OPTIONS } from './options.ts';

test('error reports sample 10% of traces and collect no personal data', () => {
  assert.equal(SENTRY_OPTIONS.tracesSampleRate, 0.1);
  const { dataCollection: dc } = SENTRY_OPTIONS;
  assert.equal(dc.userInfo, false);
  assert.equal(dc.cookies, false);
  assert.equal(dc.httpHeaders, false);
  assert.deepEqual(dc.httpBodies, []);
  assert.equal(dc.urlQueryParams, false);
  assert.equal(dc.databaseQueryData, false);
  assert.equal(dc.stackFrameVariables, false);
});

test('events pass through the scrubber before they are sent', () => {
  const sent = SENTRY_OPTIONS.beforeSend({ request: { data: 'secret', cookies: { a: 'b' } } });
  assert.equal(sent.request?.data, undefined);
  assert.equal(sent.request?.cookies, undefined);
});

test('transactions are scrubbed too', () => {
  assert.equal(SENTRY_OPTIONS.beforeSendTransaction, SENTRY_OPTIONS.beforeSend);
  const sent = SENTRY_OPTIONS.beforeSendTransaction({ request: { query_string: 'code=1', headers: { cookie: 'a' } } });
  assert.equal(sent.request?.query_string, undefined);
  assert.deepEqual(sent.request?.headers, {});
});
