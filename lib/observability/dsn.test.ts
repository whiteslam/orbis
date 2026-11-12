import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sentryIngestOrigin } from './dsn.ts';

test('the ingest origin is the DSN host, without the key or project path', () => {
  assert.equal(sentryIngestOrigin('https://abc123@o4500.ingest.us.sentry.io/4511'), 'https://o4500.ingest.us.sentry.io');
});

test('an empty, malformed or non-https DSN gives no origin', () => {
  assert.equal(sentryIngestOrigin(undefined), null);
  assert.equal(sentryIngestOrigin(''), null);
  assert.equal(sentryIngestOrigin('not a url'), null);
  assert.equal(sentryIngestOrigin('http://abc@sentry.example/1'), null);
});
