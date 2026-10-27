import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isCrossSiteRequest } from './fetch-metadata';

const headers = (site?: string) => new Headers(site === undefined ? {} : { 'sec-fetch-site': site });

test("the app's own fetches and typed addresses pass", () => {
  assert.equal(isCrossSiteRequest(headers('same-origin')), false);
  assert.equal(isCrossSiteRequest(headers('none')), false);
  assert.equal(isCrossSiteRequest(headers()), false);
});

test('a link or request from another site, or a sibling subdomain, is refused', () => {
  assert.equal(isCrossSiteRequest(headers('cross-site')), true);
  assert.equal(isCrossSiteRequest(headers('same-site')), true);
  assert.equal(isCrossSiteRequest(headers('Cross-Site')), true);
  assert.equal(isCrossSiteRequest(headers('something-new')), true);
});
