import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { siteUrl } from './site.ts';

const request = (url: string) => ({ url }) as Parameters<typeof siteUrl>[0];
const original = process.env.NEXT_PUBLIC_SITE_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = original;
});

test('a real domain written with http:// is served over https, so Meta gets the https address it has registered', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://orbis-starter.vercel.app';
  assert.equal(siteUrl(request('https://orbis-starter.vercel.app/auth/social/threads/start')), 'https://orbis-starter.vercel.app');
});
test('an https address is kept, without a trailing slash or path', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://orbis-starter.vercel.app/';
  assert.equal(siteUrl(request('https://x.example/')), 'https://orbis-starter.vercel.app');
});
test('localhost stays http, so the app can say that Meta needs https rather than pretend', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  assert.equal(siteUrl(request('http://localhost:3000/')), 'http://localhost:3000');
});
test('without a configured address, the request’s own origin is used, upgraded the same way', () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(siteUrl(request('http://orbis-starter.vercel.app/auth/social/instagram/start')), 'https://orbis-starter.vercel.app');
  assert.equal(siteUrl(request('http://127.0.0.1:3000/x')), 'http://127.0.0.1:3000');
});
