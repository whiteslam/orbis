# Service-role uses

Reviewed 2026-11-12 (Phase 0, multi-user groundwork).

## What the service role is

`createAdminClient()` in `lib/supabase/admin.ts` opens a Supabase client with the secret key. It acts as Postgres's `service_role`, which **skips row-level security** and can call `auth.admin.*` (look up, delete or ban accounts). Anything it reads, it can read for every account.

The person's own session, `createClient()` from `lib/supabase/server.ts`, runs as `authenticated` with their JWT, so the database itself only lets it see that person's rows.

## The rule

People running Orbis can't casually read a user's content, and no code reads one person's content for anything other than that person's own job (spec: `docs/superpowers/specs/2026-11-12-android-agent-design.md`, §2 anti-goals and §4 decision 7). So:

- Use the person's own session whenever row-level security and the table's grants allow what the code does.
- Use the service role only when it's actually needed:
  - a cron working for each person in turn;
  - an RPC or table that only `service_role` may touch (rate limits, AI credits, usage events, the AI registry);
  - a table holding encrypted tokens (Gmail, Zerodha, Groww, social);
  - a write people deliberately have no grant for (see `202609280200_hardening.sql`);
  - Storage buckets with no user policy;
  - `auth.admin` (account deletion, the new-account guard);
  - the public waitlist.
- Even then, every query is scoped to one `user_id` that came from the session (`requireUser()`) or from the cron's own list. Nothing takes a user id from the browser.

## How the guard works

`lib/security/admin-usage.test.ts` runs with `pnpm test`. It parses every `.ts`/`.tsx` file under `app/`, `components/`, `lib/` and `workers/`, skipping tests. It collects each file that can reach `@/lib/supabase/admin` at run time, and checks that this set equals `ADMIN_CLIENT_ALLOWLIST`.

These count:

- an import with at least one value binding;
- a bare `import '…'`;
- a re-export (`export … from`);
- `import x = require(…)`;
- a dynamic `import()` or `require()`.

These don't, because they can't open a client:

- `import type { createAdminClient }`;
- `import { type X }` when every binding is a type;
- `export type … from`.

Relative paths such as `../supabase/admin` are resolved, so they count too. The test also fails if any allowlisted file has no row in this document.

### Adding a new use

1. Try the person's own session first. Check the table's policies and grants in `supabase/migrations/` (several were narrowed in `202609280200_hardening.sql`).
2. If the service role really is needed, add a row to the table below: the file, why, whose data, whether it reads content, and the verdict.
3. Add the path to `ADMIN_CLIENT_ALLOWLIST` in `lib/security/admin-usage.test.ts`, keeping the list sorted.

If a file stops importing the client, remove it from both places; the test says which.

## Verdicts

- **ok**: the service role is needed, and any user content it touches is touched only for that person's own job.
- **switched to RLS**: the content reads now use the person's session. The file stays listed because something else in it still needs the service role.
- **needs owner decision**: a request-path read of user content that the person's session can't do today. Switching would need a migration (grants or a Storage policy) or a wider refactor. The row says why.

Counts: 44 files. 38 ok, 2 switched to RLS, 4 need an owner decision. A 45th file, `lib/notifications/context.ts`, used its value import only as a type; it is now `import type` and off the list.

## Files

| File | Why the service role is needed | Whose data | Reads user content? | Verdict |
| --- | --- | --- | --- | --- |
| `app/account/actions.ts` | "Clear social history" deletes `social_post_revisions`; people have select and insert only, so the history can't be quietly rewritten. | the signed-in person | no (delete only) | ok |
| `app/api/account/export/route.ts` | Lists the person's files across buckets. Several buckets are server-only. Tables are read with the person's session. | the signed-in person (password re-checked) | no (file names under their own folder) | ok |
| `app/api/career/ingest/route.ts` | Cron (`cronAuthorized`) that runs the job search for every Career user. | each Career user, one at a time | yes: job alerts in their mail and their career profile, for their own search | ok |
| `app/api/career/watch/route.ts` | Cron (`cronAuthorized`) that watches each user's mail for replies to applications. | each Career user, one at a time | yes: reply mail and application rows, for their own tracker | ok |
| `app/api/headsups/scan/route.ts` | Cron (`cronAuthorized`) that runs the heads-up checks for everyone with a preferences row. | each person on the scan | yes: the records the checks look at (money, routines, steps, plans), to raise their own heads-ups | ok |
| `app/api/notifications/dispatch/route.ts` | Cron (`cronAuthorized`) that sends each person's due notification slots. It reads all enabled `notification_preferences`. | each person with notifications on | yes, through `lib/notifications/context.ts` (see below), for their own notification | ok |
| `app/api/research/weekly/route.ts` | Cron (`cronAuthorized`) that queues weekly research and settles past runs. Uses `auth.admin.getUserById` to check Research-desk access by email. | Research-desk users (owner-only today) | research runs and settings only, no personal records | ok |
| `app/auth/callback/route.ts` | New-account guard: `auth.admin.deleteUser`, falling back to a ban, when sign-up isn't allowed. | the account just created | no | ok |
| `app/career/actions.ts` | "Search now" runs the cron's `ingestUser` for the signed-in person. It writes service-role bookkeeping (source cursors, last run, `career_mail`) and reads the Gmail token. | the signed-in person | yes: their job-alert mail, read from Gmail with their token, on a request path | needs owner decision: the content comes from Gmail rather than another person's rows, but the request path holds a service-role client. Splitting ingest into session-scoped reads and service-role bookkeeping is a refactor, and `career_mail` and the cursor columns have no `authenticated` write grant. Recommend keeping it. |
| `app/headsups/actions.ts` | "Clear all" deletes heads-ups. People have only `update (status, snoozed_until)`. Everything else in the file uses the session. | the signed-in person | no (delete only) | ok |
| `app/health/actions.ts` | AI credit: `dailyLimit` and the `claim_ai_credit` RPC are service-role only. | the signed-in person | was yes (saved notes, fitness persona, personal profile, daily steps); now read with the session | switched to RLS: those four tables have `for all … using ((select auth.uid()) = user_id)` and full `authenticated` grants (`202609240005`, `…0008`, `…0009`, `…0012`). |
| `app/health/library-actions.ts` | AI credit RPC. Counts the person's health documents. Inserts the generated `health_plans` row (no `authenticated` insert grant since hardening). | the signed-in person | no (a count, and a write) | ok |
| `app/invest/ai-actions.ts` | AI credit (`dailyLimit` and the claim RPC). | the signed-in person | no | ok |
| `app/personal/notification-actions.ts` | Subscribing a device inserts into `push_subscriptions`, which people can only select and delete (hardening). "Send a test" runs the cron's `deliverSlot`, which writes `notification_log`. | the signed-in person | yes: the test builds the real message from their routines, spending, steps and social plan | needs owner decision: the reads are the person's own, for their own test. But `deliverSlot`, `buildNotificationContext` and `pushToUser` take one service-role client, and `notification_log` writes are server-only. Passing a session client for the context reads only is a refactor across the cron's delivery path. |
| `app/research/actions.ts` | Research desk: queues, cancels and saves settings in `research_runs` and `research_settings`. People have select only. | the signed-in owner | no | ok |
| `app/social/actions.ts` | `consume_social_ai_request` RPC (AI quota). Everything else uses the session. | the signed-in person | no | ok |
| `app/waitlist/actions.ts` | Adds an email to `waitlist`, which has no public grants. | the visitor's own email | no | ok |
| `lib/account/delete.ts` | Account deletion: reads the user with `auth.admin.getUserById`, removes their files from every bucket, then calls `auth.admin.deleteUser`. | the signed-in person (password re-checked) | no | ok |
| `lib/ai/consent-store.ts` | Reads the person's AI on/off switch. Also used from crons and AI calls where no session exists. | one person | no (a setting) | ok |
| `lib/ai/jev.ts` | Records AI routing usage events and reads the month's spend. Both are service-role only. | one person's event; operator totals | no (only the question is sent to the model, never records) | ok |
| `lib/ai/results.ts` | Saves an AI result and prunes old ones. People have select and delete only (hardening). Reads already use the session. | one person | no (writes their result; the prune reads only `created_at`) | ok |
| `lib/ai/router.ts` | Reads the AI provider and model registry, marks failing models, and logs every attempt to `ai_generation_events`. All service-role only. | operator tables; one person's events | no | ok |
| `lib/ai/usage-store.ts` | The person's own AI usage this month, plus the whole month's bill. `ai_generation_events` has no `authenticated` grant. | the signed-in person; operator totals | no (counters and costs) | ok |
| `lib/ask/answer.ts` | Ask Orbis quota: `consume_ask_orbis_request` RPC and `dailyLimit`. | one person | no | ok |
| `lib/career/ai.ts` | AI credit for Career features (claim RPC and `dailyLimit`). | one person | no | ok |
| `lib/career/drafting.ts` | Checks whether a draft's owner was deleted mid-render (`auth.admin.getUserById`), and removes the files it just wrote if so. | one person | no | ok |
| `lib/career/repository.ts` | Gmail status comes from `gmail_connections`, which holds tokens. Send locks are written to `career_events.gmail_message_id`, which only the service role writes. Content reads use the caller's client (the session on request paths). | one person | no (status and lock rows) | ok |
| `lib/career/send.ts` | Reads the Gmail connection (encrypted refresh token) to send an application or reply. | one person | no (the token, not content) | ok |
| `lib/career/watch.ts` | Cron helpers for the mail watch. When the owner attaches a reply, `reclassifyEvent` rewrites `kind/summary/details`, and people only have `update (application_id)`. | each Career user | yes in the cron (their reply mail); the attach path writes only | ok |
| `lib/gmail/connection.ts` | Loads, refreshes and disconnects the Gmail connection (encrypted tokens). | one person | no (tokens) | ok |
| `lib/gmail/oauth.ts` | Saves the Gmail connection after OAuth (encrypted tokens). | one person | no | ok |
| `lib/headsups/repository.ts` | Creating the person's `headsup_preferences` row the first time; people have no insert grant on it. | the signed-in person | was yes (heads-up titles and bodies); now read with the session | switched to RLS: the list, the dismissed count, the prefs read and "mark seen" now use the session. `headsups` has `grant select`, `grant update (status, snoozed_until)`, and select/update policies on `(select auth.uid()) = user_id`; `headsup_preferences` has `grant select` with a select-own policy (`202609300100_headsups.sql`). `app/headsups/actions.ts` already updates `status` with the session. `getHeadsupPrefs` still reads only `disabled_kinds` (a setting) with the service role. |
| `lib/health-docs/repository.ts` | Uploads, indexing, document deletion, "always include", signed downloads and chunk search. Hardening gave people select on `health_documents` only. Chunks, the `match_health_chunks` RPC and the health bucket are service-role only. | one person | yes: health document text (chunks) for Ask and health plans, on request paths | needs owner decision: reading chunks with the session would need `grant select on health_document_chunks`, a select-own policy, a session-callable `match_health_chunks` keyed on `auth.uid()`, and a Storage policy. All are migrations, and they undo a deliberate hardening choice. |
| `lib/home/brief-service.ts` | AI credit for the Home brief (claim RPC and `dailyLimit`). | one person | no | ok |
| `lib/invest/groww-connection.ts` | Groww credentials (encrypted). | one person | no (tokens) | ok |
| `lib/invest/zerodha-connection.ts` | Zerodha session (encrypted). | one person | no (tokens) | ok |
| `lib/marketing/waitlist.ts` | Counts the waitlist for the public front page. | nobody's in particular | no (a count) | ok |
| `lib/news/portfolio.ts` | AI credit for portfolio news (claim RPC and `dailyLimit`). | one person | no | ok |
| `lib/providers/cache.ts` | Shared market-data cache, provider status and daily call counter. None of these belong to a user. | none (shared) | no | ok |
| `lib/providers/status.ts` | Connection status from the token tables (Gmail, Groww, Zerodha), plus shared provider health and usage. | the signed-in person | no (status and timestamps) | ok |
| `lib/security/pin-store.ts` | The app-lock PIN hash and the attempt-counting RPC. Both are service-role only, so a session can't reset its own failures. | one person | no | ok |
| `lib/security/rate-limit.ts` | `consume_rate_limit` and `consume_anon_rate_limit` RPCs. | one person, or an anonymous address key | no | ok |
| `lib/social/connections.ts` | Social platform sessions (encrypted tokens). | one person | no (tokens) | ok |
| `lib/storage/signed-upload.ts` | Signs uploads into, reads back and removes files from the staging bucket, which deliberately has no user policy. Claims each staged path once in `staged_upload_claims`. | the signed-in uploader | yes: the file they just uploaded, read once to parse it for their own request | needs owner decision: reading it with the session would need a select-own Storage policy on the staging bucket. With no policy, a leaked upload token can't be used to read or list files. Recommend keeping it. |

### Type-only importers (not on the allowlist)

These name the client's type for a parameter. The caller hands them the client, so they can't open one themselves:

- `lib/ai/budget.ts`
- `lib/ai/events.ts`
- `lib/ai/limits.ts`
- `lib/headsups/scan.ts`
- `lib/locale/repository.ts`
- `lib/notifications/context.ts` (changed to `import type` in this review)
- `lib/notifications/deliver.ts`
- `lib/notifications/push.ts`
- `lib/security/roles.ts`

`lib/notifications/context.ts` reads the person's routines, spending, steps, persona and social plan to word their notification. It is called by the dispatch cron and by "Send a test" (see `app/personal/notification-actions.ts` above).

`workers/research-desk` is Python. It holds the service key in a private repository's Actions secrets and is not scanned by the guard.
