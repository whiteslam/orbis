import { test } from 'vitest';
import assert from 'node:assert/strict';
import { strategyFor } from './sw-routing';

const origin = 'https://orbis.app';
test('page navigations fall back to the offline page', () => {
  assert.equal(strategyFor({ mode: 'navigate', url: 'https://orbis.app/', method: 'GET' }, origin), 'network-first-offline');
});
test('hashed static assets are cache-first', () => {
  assert.equal(strategyFor({ mode: 'no-cors', url: 'https://orbis.app/_next/static/chunks/a1b2.js', method: 'GET' }, origin), 'cache-first');
});
test('API calls, other origins and non-GETs are never cached', () => {
  assert.equal(strategyFor({ mode: 'cors', url: 'https://orbis.app/api/home/brief', method: 'GET' }, origin), 'passthrough');
  assert.equal(strategyFor({ mode: 'cors', url: 'https://proj.supabase.co/rest/v1/x', method: 'GET' }, origin), 'passthrough');
  assert.equal(strategyFor({ mode: 'navigate', url: 'https://orbis.app/', method: 'POST' }, origin), 'passthrough');
});
