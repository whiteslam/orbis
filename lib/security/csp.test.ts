import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildCsp } from './csp';

const csp = buildCsp({ nonce: 'abc123', supabaseUrl: 'https://proj.supabase.co', isDev: false });
const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

test('scripts need the nonce and nothing inline or eval in production', () => {
  assert.match(directive('script-src'), /'nonce-abc123'/);
  assert.match(directive('script-src'), /'strict-dynamic'/);
  assert.doesNotMatch(directive('script-src'), /unsafe-inline|unsafe-eval/);
});

test('dev allows eval for React debugging only', () => {
  assert.match(buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: true }), /'unsafe-eval'/);
});

test('the app cannot be framed and forms only post to itself and the OAuth providers', () => {
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.match(directive('form-action'), /'self'/);
  assert.equal(directive('object-src'), "object-src 'none'");
});

test('supabase is reachable for data, realtime, images and media', () => {
  assert.match(directive('connect-src'), /https:\/\/proj\.supabase\.co/);
  assert.match(directive('connect-src'), /wss:\/\/proj\.supabase\.co/);
  assert.match(directive('img-src'), /https:\/\/proj\.supabase\.co/);
  assert.match(directive('media-src'), /https:\/\/proj\.supabase\.co/);
});

test('inline style attributes keep working (the UI uses style={…})', () => {
  assert.match(directive('style-src'), /'unsafe-inline'/);
});

test('the app may show https pictures (news photos), never http ones; the public pages may not', () => {
  assert.match(directive('img-src'), / https:$/);
  assert.doesNotMatch(directive('img-src'), /http:/);
  const publicImg = buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: false, scope: 'public' }).split(';').map((part) => part.trim()).find((part) => part.startsWith('img-src ')) ?? '';
  assert.equal(publicImg, "img-src 'self' data:");
});

test('the error-reporting host is allowed to receive reports only when a browser DSN is set', () => {
  assert.doesNotMatch(csp, /sentry/);
  const withDsn = buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: false, sentryDsn: 'https://key@o1.ingest.us.sentry.io/2' });
  const connect = withDsn.split(';').map((part) => part.trim()).find((part) => part.startsWith('connect-src ')) ?? '';
  assert.match(connect, / https:\/\/o1\.ingest\.us\.sentry\.io$/);
  assert.doesNotMatch(connect, /key@/);
  const bad = buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: false, sentryDsn: 'garbage' });
  assert.doesNotMatch(bad, /sentry|garbage/);
});

test('the public pages never name the error-reporting host', () => {
  const publicCsp = buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: false, scope: 'public', sentryDsn: 'https://key@o1.ingest.us.sentry.io/2' });
  assert.doesNotMatch(publicCsp, /sentry/);
});
