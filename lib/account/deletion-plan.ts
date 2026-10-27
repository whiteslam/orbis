// What deleting an account removes, in what order, and what an export contains.
// Pure, so the plan can be tested without a database.

import { rateLimitMessage } from '@/lib/security/rate-limit-rules';
import { hasFreshAuth } from '@/lib/security/unlock-token';
import { indiaToday } from '@/lib/social/month';

export type DeletionStep = 'revoke-connections' | 'remove-research' | 'remove-storage' | 'delete-user' | 'sweep-storage';

/** The Research desk's tables, children first, so no delete is blocked by a foreign key. */
export const RESEARCH_TABLES: readonly string[] = ['research_events', 'research_settlements', 'research_runs', 'research_settings'];

/**
 * Third-party connections are revoked first, while their tokens can still be
 * read. The Research desk's rows are deleted next, not just cancelled: a worker
 * in flight checks that its run (or, when settling, any of the owner's rows)
 * still exists before it puts the memory log back, and a cancelled row would
 * pass that check. Then every stored file goes; then the auth user, whose
 * removal cascades to every row that references it. Anything that fails before
 * `delete-user` leaves the account itself in place, so it can be tried again.
 * Last, the buckets are swept once more, best effort, for a file a worker or
 * cron wrote between its own check and the first wipe.
 */
export function deletionSteps(): DeletionStep[] {
  return ['revoke-connections', 'remove-research', 'remove-storage', 'delete-user', 'sweep-storage'];
}

/** A step after the account is gone: its failure is logged, never shown, since there is nothing left to retry. */
export function deletionStepIsBestEffort(step: DeletionStep) {
  return step === 'sweep-storage';
}

/** Every private bucket that holds files under `${userId}/`. */
export const STORAGE_BUCKETS: readonly string[] = ['health-documents', 'social-media', 'journal-voice', 'workbook-uploads', 'career-documents', 'research-memory'];

/** `key` is the column each table's rows are paged by: its primary key. */
export type ExportTable = { table: string; columns: '*'; key: 'id' | 'user_id' };

// One row per person, keyed by user_id; every other table has its own id.
const SINGLE_ROW_TABLES = new Set(['user_personal_profiles', 'user_fitness_personas', 'user_locations', 'ai_preferences', 'notification_preferences', 'headsup_preferences', 'career_profiles', 'research_settings']);

/**
 * The person's own content, read through their own session so row-level
 * security keeps it to their rows. Left out on purpose (see the task report):
 * stored credentials (gmail_connections, groww_connections, zerodha_connections,
 * user_app_pins, push_subscriptions), and service internals that are not
 * content (gmail_sync_messages, health_document_chunks, rate_limit_buckets,
 * staged_upload_claims, workbook_ai_usage, ai_feature_usage, social_ai_usage, ask_orbis_usage,
 * ai_generation_events, and career_mail, the career watcher's record of which
 * Gmail messages it has handled, which goes with the account by cascade).
 * Shared tables with no user_id (api_*, ai_providers, ai_models) hold nothing
 * personal. The career-documents bucket (the resume and tailored files) is
 * listed and emptied like the other buckets, and so is research-memory (the
 * Research desk's memory log, written only by its worker). The research tables
 * are deleted outright before storage is emptied (see `deletionSteps`); every
 * one also references auth.users on delete cascade.
 */
export const EXPORT_TABLES: readonly ExportTable[] = [
  'user_personal_profiles',
  'user_fitness_personas',
  'user_context_notes',
  'user_locations',
  'ai_preferences',
  'notification_preferences',
  'transactions',
  'investment_holdings',
  'goals',
  'habits',
  'habit_checkins',
  'journal_entries',
  'routines',
  'routine_events',
  'health_import_batches',
  'health_daily_steps',
  'health_documents',
  'health_plans',
  'ai_results',
  'notification_log',
  'social_posts',
  'social_post_revisions',
  'journal_entry_revisions',
  'context_note_revisions',
  'journal_voice_notes',
  'headsups',
  'headsup_preferences',
  'mail_acknowledgements',
  'career_profiles',
  'career_jobs',
  'career_applications',
  'career_events',
  'career_offers',
  'research_runs',
  'research_events',
  'research_settlements',
  'research_settings',
].map((table) => ({ table, columns: '*' as const, key: SINGLE_ROW_TABLES.has(table) ? 'user_id' as const : 'id' as const }));

/** Within this long of any sign-in, the session alone is proof enough. */
export const DELETION_FRESH_AUTH_SEC = 10 * 60;

export function deletionConfirmed(confirm: unknown) {
  return typeof confirm === 'string' && confirm.trim() === 'DELETE';
}

export type SensitiveAuthCheck = { ok: true } | { ok: false; needs: 'unlock' | 'password' };

/**
 * Deleting the account or exporting its data needs Orbis unlocked on this
 * device, always, and either a sign-in in the last ten minutes or the password
 * given again, so a stolen cookie or a device left open isn't enough.
 */
export function sensitiveAuthCheck(input: { amr: unknown; nowSec: number; unlocked: boolean; passwordVerified: boolean }): SensitiveAuthCheck {
  if (!input.unlocked) return { ok: false, needs: 'unlock' };
  if (input.passwordVerified || hasFreshAuth(input.amr, input.nowSec, DELETION_FRESH_AUTH_SEC)) return { ok: true };
  return { ok: false, needs: 'password' };
}

export type SensitiveRefusal = 'signed-out' | 'unlock' | 'password' | 'wrong-password' | 'rate-limited';

/** The HTTP status for a refused export: 401 when signed out, 429 after too many password tries, 403 otherwise. */
export function refusalStatus(reason: SensitiveRefusal) {
  if (reason === 'rate-limited') return 429;
  return reason === 'signed-out' ? 401 : 403;
}

/** What to tell someone who was refused, for "delete your account" or "export your data". */
export function refusalMessage(reason: SensitiveRefusal, doing: string) {
  switch (reason) {
    case 'signed-out':
      return `Sign in again to ${doing}.`;
    case 'unlock':
      return `Unlock Orbis on this device first, then ${doing}.`;
    case 'password':
      return `Enter your password to ${doing}. It’s only needed if you haven’t signed in in the last 10 minutes.`;
    case 'wrong-password':
      return 'That password isn’t right. Try again.';
    case 'rate-limited':
      return rateLimitMessage('password');
  }
}

/**
 * Storage answers a missing bucket with statusCode 404 and "Bucket not found";
 * that bucket has nothing to empty. Any other error is a real failure.
 */
export function isMissingBucketError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { message, statusCode } = error as { message?: unknown; statusCode?: unknown };
  if (statusCode === '404' || statusCode === 404) return true;
  return typeof message === 'string' && /bucket not found/i.test(message);
}

export function exportFilename(now = new Date()) {
  return `orbis-export-${indiaToday(now)}.json`;
}
