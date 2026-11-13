import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SOURCES as SERVER_SOURCES, type Source } from '@/lib/device/http';
import { SOURCES } from '@/lib/device/sources';
import { isNativeApp, type CoreStatus, type Privacy } from './orbis-core';

// True only when A and B are the same type (not merely assignable either way).
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

test('isNativeApp is false outside the Android app', () => {
  assert.equal(isNativeApp(), false);
});

test('status and privacy sources are keyed by the server wire names', () => {
  // Compile-time checks (tsc --noEmit fails if either is false); the asserts keep them in the run.
  const statusSources: Equal<CoreStatus['sources'], Record<Source, boolean>> = true;
  const privacySources: Equal<Privacy['sources'], Record<Source, boolean>> = true;
  const keys: Equal<keyof CoreStatus['sources'], Source> = true;
  assert.equal(statusSources && privacySources && keys, true);
});

test('the client-safe source list is the one the server checks', () => {
  assert.equal(SOURCES, SERVER_SOURCES);
  assert.deepEqual(
    [...SOURCES],
    ['test', 'notifications', 'calendar', 'contacts', 'calls', 'health', 'usage', 'phone_state', 'location'],
  );
});
