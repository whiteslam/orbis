import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DELETION_FRESH_AUTH_SEC,
  EXPORT_TABLES,
  STORAGE_BUCKETS,
  deletionConfirmed,
  deletionSteps,
  exportFilename,
  isMissingBucketError,
  refusalMessage,
  refusalStatus,
  sensitiveAuthCheck,
} from './deletion-plan';

test('the auth user is deleted last, after connections and files', () => {
  assert.deepEqual(deletionSteps(), ['revoke-connections', 'remove-storage', 'delete-user']);
});
test('every private bucket is emptied', () => {
  for (const bucket of ['health-documents', 'social-media', 'journal-voice', 'workbook-uploads']) assert.ok(STORAGE_BUCKETS.includes(bucket), bucket);
});
test('the export never includes stored credentials', () => {
  const tables = EXPORT_TABLES.map((entry) => entry.table);
  for (const secret of ['gmail_connections', 'groww_connections', 'zerodha_connections', 'user_app_pins', 'push_subscriptions']) assert.ok(!tables.includes(secret), secret);
  for (const table of ['transactions', 'social_posts', 'routines']) assert.ok(tables.includes(table), table);
});

test('the export leaves out service internals and lists each table once', () => {
  const tables = EXPORT_TABLES.map((entry) => entry.table);
  for (const internal of ['gmail_sync_messages', 'rate_limit_buckets', 'staged_upload_claims', 'health_document_chunks', 'social_ai_usage', 'workbook_ai_usage', 'ai_generation_events']) {
    assert.ok(!tables.includes(internal), internal);
  }
  assert.equal(new Set(tables).size, tables.length);
  for (const entry of EXPORT_TABLES) assert.equal(entry.columns, '*');
  // Rows are paged by primary key; the one-row-per-person tables have no id.
  assert.equal(EXPORT_TABLES.find((entry) => entry.table === 'user_personal_profiles')?.key, 'user_id');
  assert.equal(EXPORT_TABLES.find((entry) => entry.table === 'transactions')?.key, 'id');
});

test('deletion needs the word DELETE typed exactly', () => {
  assert.equal(deletionConfirmed('DELETE'), true);
  assert.equal(deletionConfirmed(' DELETE '), true);
  assert.equal(deletionConfirmed('delete'), false);
  assert.equal(deletionConfirmed(''), false);
  assert.equal(deletionConfirmed(undefined), false);
});

test('deleting or exporting needs a sign-in within ten minutes or the password, and a locked device never passes', () => {
  const now = 1_800_000_000;
  const fresh = [{ method: 'password', timestamp: now - 120 }];
  const freshOtp = [{ method: 'otp', timestamp: now - 60 }];
  const stale = [{ method: 'password', timestamp: now - DELETION_FRESH_AUTH_SEC - 1 }];
  assert.equal(DELETION_FRESH_AUTH_SEC, 600);
  assert.deepEqual(sensitiveAuthCheck({ amr: fresh, nowSec: now, unlocked: true, passwordVerified: false }), { ok: true });
  assert.deepEqual(sensitiveAuthCheck({ amr: freshOtp, nowSec: now, unlocked: true, passwordVerified: false }), { ok: true });
  assert.deepEqual(sensitiveAuthCheck({ amr: stale, nowSec: now, unlocked: true, passwordVerified: false }), { ok: false, needs: 'password' });
  assert.deepEqual(sensitiveAuthCheck({ amr: stale, nowSec: now, unlocked: true, passwordVerified: true }), { ok: true });
  assert.deepEqual(sensitiveAuthCheck({ amr: fresh, nowSec: now, unlocked: false, passwordVerified: true }), { ok: false, needs: 'unlock' });
  assert.deepEqual(sensitiveAuthCheck({ amr: undefined, nowSec: now, unlocked: true, passwordVerified: false }), { ok: false, needs: 'password' });
  // A refreshed token keeps its original timestamp, so an old session never looks fresh.
  assert.deepEqual(sensitiveAuthCheck({ amr: [{ method: 'password' }], nowSec: now, unlocked: true, passwordVerified: false }), { ok: false, needs: 'password' });
});

test('a missing bucket is recognised so it can be skipped', () => {
  assert.equal(isMissingBucketError({ message: 'Bucket not found', status: 400, statusCode: '404' }), true);
  assert.equal(isMissingBucketError({ message: 'Bucket not found' }), true);
  assert.equal(isMissingBucketError({ message: 'Something', statusCode: '404' }), true);
  // Any other not-found (an object, a route) is a real failure, not a missing bucket.
  assert.equal(isMissingBucketError({ message: 'Object not found', status: 400, statusCode: '400' }), false);
  assert.equal(isMissingBucketError({ message: 'The resource was not found', status: 404 }), false);
  assert.equal(isMissingBucketError({ message: 'Internal error', status: 500 }), false);
  assert.equal(isMissingBucketError(null), false);
});

test('the export file is named for the day it was made, in India', () => {
  assert.equal(exportFilename(new Date('2026-09-28T06:00:00Z')), 'orbis-export-2026-09-28.json');
  // 20:00 UTC is already the next morning in India.
  assert.equal(exportFilename(new Date('2026-09-28T20:00:00Z')), 'orbis-export-2026-09-29.json');
});

test('a refused export or deletion says what to do, and a signed-out export is a 401', () => {
  assert.equal(refusalMessage('password', 'export your data'), 'Enter your password to export your data. It’s only needed if you haven’t signed in in the last 10 minutes.');
  assert.equal(refusalMessage('unlock', 'delete your account'), 'Unlock Orbis on this device first, then delete your account.');
  assert.equal(refusalMessage('signed-out', 'export your data'), 'Sign in again to export your data.');
  assert.equal(refusalMessage('wrong-password', 'export your data'), 'That password isn’t right. Try again.');
  assert.equal(refusalMessage('rate-limited', 'export your data'), 'Too many password attempts. Try again in 15 minutes.');
  assert.equal(refusalStatus('signed-out'), 401);
  assert.equal(refusalStatus('rate-limited'), 429);
  for (const reason of ['unlock', 'password', 'wrong-password'] as const) assert.equal(refusalStatus(reason), 403);
});
