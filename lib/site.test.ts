import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { siteUrl, supportEmail } from './site';

afterEach(() => { delete process.env.NEXT_PUBLIC_SITE_URL; delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL; });
test('siteUrl trims a trailing slash and falls back to the production URL', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://orbis.app/';
  assert.equal(siteUrl(), 'https://orbis.app');
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(siteUrl(), 'https://orbis-starter.vercel.app');
});
test('supportEmail is null until it is configured, and rejects junk', () => {
  assert.equal(supportEmail(), null);
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'help@orbis.app';
  assert.equal(supportEmail(), 'help@orbis.app');
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'not-an-email';
  assert.equal(supportEmail(), null);
});
