import { test } from 'vitest';
import assert from 'node:assert/strict';
import { phoneTablesMissing } from './not-set-up';

test('a missing phone table reads as not set up yet', () => {
  assert.equal(phoneTablesMissing({ code: 'PGRST205', message: "Could not find the table 'public.devices' in the schema cache" }), true);
  assert.equal(phoneTablesMissing({ code: '42P01', message: 'relation "public.signals" does not exist' }), true);
  // Without a code, the Postgres wording alone is enough.
  assert.equal(phoneTablesMissing({ message: 'relation "public.activity_ledger" does not exist' }), true);
  assert.equal(phoneTablesMissing('PGRST205'), true);
});

test('any other failure is a real failure', () => {
  assert.equal(phoneTablesMissing({ code: '42501', message: 'permission denied for table devices' }), false);
  assert.equal(phoneTablesMissing({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assert.equal(phoneTablesMissing({ message: 'fetch failed' }), false);
  assert.equal(phoneTablesMissing(new Error('network')), false);
  assert.equal(phoneTablesMissing(null), false);
  assert.equal(phoneTablesMissing(undefined), false);
});
