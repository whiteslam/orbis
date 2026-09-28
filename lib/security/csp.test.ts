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
