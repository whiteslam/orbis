# YouTube Publishing (Shorts sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished short can be added to a YouTube queue from Social → Shorts, and Orbis's server uploads one a day on the person's schedule (or now, on request) to their connected channel.

**Architecture:** One migration adds YouTube to `social_connections` (with an encrypted refresh token) and three tables: settings, presets and the queue. Pure modules decide details, due-ness and the upload state machine. A server-only publisher streams byte ranges from the private `shorts` bucket into a YouTube resumable session, a slice of about 45 s per call. A pg_cron job calls `POST /api/social/youtube/publish` every 10 minutes, and the **Post now** server action runs the same code for one row.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs` before using an API you haven't checked), Supabase (RLS, service role, Storage), Vitest + PGlite, YouTube Data API v3, Google OAuth 2.0.

**Spec:** `docs/superpowers/specs/2026-11-13-youtube-publishing-design.md`

## Global Constraints

- Work in worktree `F:\Orbis\orbis-youtube`, branch `youtube`. Never write into `F:\Orbis\orbis`.
- Scopes, exactly: `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`; `access_type=offline`, `prompt=consent`.
- Credentials: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (same web client as Gmail). Redirect URI: `<siteUrl(request)>/auth/youtube/callback`. Do **not** use `getGmailConfig()`, because it also requires Gmail-only settings.
- Every stored token is encrypted with `encryptCredential` / `decryptCredential` (`lib/crypto/credentials.ts`). No token reaches the browser.
- Limits: title 1–100 characters (count code points: `[...s].length`), description ≤ 5000, tags joined length ≤ 500, error ≤ 500, upload chunks 8 MB (`8 * 1024 * 1024`), slice budget about 45 s, cron every 10 minutes.
- YouTube rejects `<` and `>` in titles and descriptions: strip them.
- Defaults: `post_time` 18:00, `days` all of ISO 1–7, `paused` false, privacy `public`, made-for-kids `false`.
- Style presets: `tall-tale` → `23`; `cozy-tales` → `1`; `deep-dive`, `inside-out`, `paper-atlas` → `27`; `night-file`, `stick-story` → `24`. Any other style falls back to `24`. Slugs must match `shorts_styles.slug`; check the real slugs with `grep -rn "slug" workers/shorts-studio/src/fixtures` and use what is there if they differ.
- Copy follows the app's voice: plain English, short sentences, curly apostrophes (’) in UI text, as in `components/shorts/*`.
- Every new service-role import gets a row in `docs/security/service-role-uses.md` and a path in `ADMIN_CLIENT_ALLOWLIST` (`lib/security/admin-usage.test.ts`), kept sorted.
- Unit tests live under `lib/**` or `workers/shorts-studio/src/**`; vitest only runs those globs.
- Finish every task with `pnpm typecheck`, `pnpm lint` and `pnpm test` all green.

### Rulings (where this plan goes beyond the spec)

- **R1 Per person, not owner-only.** Shorts is per person, so the publish route serves every user who has a connected YouTube and work to do. It is bounded by the time budget, and users are taken in order of their oldest due row.
- **R2 Time zone.** `youtube_settings.timezone` is created from the person's own zone (`getPersonSettingsAdmin`), not hard-coded to `Asia/Kolkata`. The column default stays `Asia/Kolkata` for SQL-only inserts.
- **R3 Lease.** New column `youtube_queue.lease_until timestamptz`. Every slice (cron or Post now) first takes the row with a guarded update: `status` is still the expected one, and `lease_until` is null or in the past. The update sets `lease_until = now() + 75 s` and the slice clears it at the end. Two runs never send chunks for the same row.
- **R4 Uploading rows always resume.** Before the due check, the route resumes any `uploading` row whose lease is free, whether or not the person is due. So a Post now that needed more than one slice finishes within about 10 minutes. `posted_by` is set when the row is claimed into `uploading`.
- **R5 Quota hold.** New column `youtube_settings.hold_until timestamptz`. On 403 `quotaExceeded` or `uploadLimitExceeded`, it is set to the start of the next local day. The due check is false before then. The row goes back to `queued` and keeps its position.
- **R6 Delete guard.** `deleteShortAction` refuses while the short has a `queued` or `uploading` queue row, with "Remove it from the YouTube queue first." Published rows don't block a delete.

## Review Focus

1. **Titles with `<`, `>`, emoji or over 100 code points** must upload, not fail with `invalidTitle`. `buildDetails` and `cleanDetails` strip angle brackets and trim by code points (tests in Task 2).
2. **A Post now racing the cron run on the same row** must never send the same bytes twice. This is the lease from R3 (repository test in Task 4).
3. **"Already posted today" across midnight and outside India**, for example a 23:50 post yesterday in `America/New_York`, must not block today's post. A manual post earlier today must not block the scheduled one (tests in Task 2).
4. **A file whose size is an exact multiple of 8 MB, or a 0-byte file:** the last `Content-Range` must be right, and an empty file must fail at once with "video file missing" (tests in Task 4).
5. **Deleting a short that is waiting in the YouTube queue** must be refused, not leave a row whose video is gone (R6, test in Task 5).

---

### Task 1: Migration, schedule file and schema test

**Files:**
- Create: `supabase/migrations/202611130002_youtube.sql`
- Create: `supabase/cron/youtube_schedule.sql`
- Create: `lib/youtube/sql-harness.ts`
- Test: `lib/youtube/schema.test.ts`

**Interfaces:**
- Produces the tables and columns below, which every later task uses with these exact names.
  - `social_connections`:
    - `platform` check becomes `('instagram','threads','youtube')`;
    - adds `refresh_token_encrypted text` (nullable).
  - `youtube_settings`:
    - `user_id uuid pk → auth.users on delete cascade`;
    - `post_time time not null default '18:00'`;
    - `days smallint[] not null default '{1,2,3,4,5,6,7}'`, with a check that it is non-empty, a subset of 1–7, and has at most 7 entries;
    - `timezone text not null default 'Asia/Kolkata'`, check length 1–64;
    - `paused boolean not null default false`;
    - `hold_until timestamptz`;
    - `updated_at timestamptz not null default now()`, plus the `set_updated_at` trigger.
  - `youtube_presets`:
    - `user_id uuid → auth.users on delete cascade`;
    - `style text` matching `^[a-z0-9-]{2,40}$`; primary key `(user_id, style)`;
    - `privacy text not null default 'public'`, in public/unlisted/private;
    - `category_id text not null default '24'`, matching `^[0-9]{1,3}$`;
    - `made_for_kids boolean not null default false`;
    - `tags text[] not null default '{}'`, with `array_length` ≤ 30.
  - `youtube_queue`:
    - `id uuid pk default gen_random_uuid()`;
    - `user_id uuid not null → auth.users on delete cascade`;
    - `job_id uuid null references shorts_jobs(id) on delete set null`;
    - `video_path text not null`, length 1–300;
    - `cover_path text`, length ≤ 300;
    - `title text not null`, length 1–100;
    - `description text not null default ''`, length ≤ 5000;
    - `tags text[] not null default '{}'`;
    - `category_id text not null`, matching `^[0-9]{1,3}$`;
    - `privacy text not null`, in public/unlisted/private;
    - `made_for_kids boolean not null default false`;
    - `position integer not null`;
    - `status text not null default 'queued'`, in `('queued','uploading','published','failed','removed')`;
    - `upload_url text`, length ≤ 2000;
    - `bytes_sent bigint not null default 0`, ≥ 0;
    - `upload_started_at timestamptz`;
    - `lease_until timestamptz`;
    - `youtube_id text`, length ≤ 64;
    - `published_privacy text`;
    - `published_at timestamptz`;
    - `posted_by text`, in `('schedule','manual')`;
    - `error text`, length ≤ 500;
    - `attempts smallint not null default 0`, 0–50;
    - `created_at` and `updated_at`, plus the `set_updated_at` trigger.
    - Indexes: `(user_id, status, position)` and `(user_id, published_at desc)`.
    - A unique partial index on `(user_id, job_id) where job_id is not null and status in ('queued','uploading','published')`, so one short can't be queued twice.
  - RLS on all three: `enable row level security`; `revoke all … from public, anon, authenticated`; `grant select to authenticated` with a policy `(select auth.uid()) = user_id`; full grants to `service_role`. Writes go through server actions using the service role (same model as `shorts_jobs`).
- Schedule file: copy the shape of `supabase/cron/headsups_schedule.sql`, with job name `orbis-youtube`, schedule `*/10 * * * *`, URL `https://orbis-starter.vercel.app/api/social/youtube/publish` and `timeout_milliseconds := 55000`.

- [ ] **Step 1: Write `lib/youtube/sql-harness.ts`.** Use the same stubs as `lib/device/sql-harness.ts`, plus:
  - `create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;`
  - `create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`
  - `create table public.social_posts (id uuid primary key default gen_random_uuid());`
  - `create role service_role nologin;`

  It loads `202610010027_social_connections.sql`, `202611100001_shorts.sql` and `202611130002_youtube.sql`, in that order. Export `bootDb()`, `asUser()`, `USER_A`, `USER_B`.
- [ ] **Step 2: Write the failing tests in `lib/youtube/schema.test.ts`.**
  - `social_connections accepts platform youtube with a refresh token`;
  - `a person reads only their own youtube_queue, settings and presets rows` (insert as superuser for A and B, select as A → A's only);
  - `authenticated cannot insert, update or delete youtube_queue` (each throws permission denied);
  - `a short can't be queued twice while queued or published, but can again after removed` (second insert with the same `job_id` throws a unique violation; after setting the first to `removed` it succeeds);
  - `deleting the shorts job sets job_id null and keeps the queue row`;
  - `days must be a non-empty subset of 1–7` (`'{0}'` and `'{}'` throw);
  - `the migration runs twice without error` (call `loadMigration` for the YouTube file again).
- [ ] **Step 3: Run** `pnpm vitest run lib/youtube/schema.test.ts`. It should fail because the migration file doesn't exist yet.
- [ ] **Step 4: Write the migration.** Make it idempotent like its neighbours: `if not exists`, `drop … if exists` before policies and triggers, and swap the platform check by `drop constraint if exists social_connections_platform_check` then `add`. Check the real constraint name with PGlite (`select conname from pg_constraint where conrelid='public.social_connections'::regclass`). Open the file with a comment in the style of the Shorts migration, naming the spec. Then write `supabase/cron/youtube_schedule.sql`.
- [ ] **Step 5: Run** `pnpm vitest run lib/youtube/schema.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `git add supabase lib/youtube && git commit -m "YouTube: migration, schedule file and schema tests"`.

### Task 2: Pure rules: details, due check, next slot

**Files:**
- Create: `lib/youtube/types.ts` (client-safe)
- Create: `lib/youtube/details.ts` (client-safe)
- Create: `lib/youtube/schedule.ts` (client-safe)
- Test: `lib/youtube/details.test.ts`, `lib/youtube/schedule.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export type Privacy = 'public' | 'unlisted' | 'private';
  export type QueueStatus = 'queued' | 'uploading' | 'published' | 'failed' | 'removed';
  export type VideoDetails = { title: string; description: string; tags: string[]; categoryId: string; privacy: Privacy; madeForKids: boolean };
  export type Preset = { style: string; privacy: Privacy; categoryId: string; madeForKids: boolean; tags: string[] };
  export type Schedule = { postTime: string /* 'HH:MM' */; days: number[] /* ISO 1–7 */; timezone: string; paused: boolean; holdUntil: string | null };
  export type QueueItem = VideoDetails & {
    id: string; jobId: string | null; videoPath: string; coverPath: string | null; position: number; status: QueueStatus;
    bytesSent: number; youtubeId: string | null; publishedPrivacy: Privacy | null; publishedAt: string | null;
    postedBy: 'schedule' | 'manual' | null; error: string | null; attempts: number;
  };
  export type YouTubeConnection = { channelTitle: string | null; status: 'connected' | 'reconnect_required' } | null;
  export type YouTubePanel = { configured: boolean; ready: boolean; connection: YouTubeConnection; schedule: Schedule; queue: QueueItem[]; posted: QueueItem[]; covers: Record<string, string>; next: string | null };
  ```
- Produces in `details.ts`:
  - constants `TITLE_MAX = 100`, `DESCRIPTION_MAX = 5000`, `TAGS_MAX = 500`, `MAX_ATTEMPTS = 3`, `CATEGORIES` (the ids `1, 23, 24, 27` with labels Film & Animation, Comedy, Entertainment and Education);
  - `defaultPreset(style: string): Preset`;
  - `buildDetails(delivery: Pick<Delivery,'title'|'caption'|'hashtags'>, preset: Preset): VideoDetails`;
  - `cleanDetails(input: unknown): VideoDetails | null`, which validates and normalises what the browser sends;
  - `tagsLength(tags: string[]): number`.
- Produces in `schedule.ts`:
  - `localDay(at: Date, timeZone: string): { date: string /* YYYY-MM-DD */; isoDay: number; minutes: number }`;
  - `isDue(schedule: Schedule, now: Date, lastScheduledAt: string | null): boolean`;
  - `nextSlot(schedule: Schedule, now: Date, postedToday: boolean): Date | null`;
  - `nextDayStart(now: Date, timeZone: string): Date`, used for `hold_until`.

- [ ] **Step 1: Write the failing tests.**
  - `details.test.ts`:
    - `buildDetails trims the title to 100 code points and strips < and >`: a title of `'<b>' + '😀'.repeat(120)` gives `[...title].length === 100` with no `<`.
    - `#shorts is appended once`: hashtags `['#ai']` give a description ending `'#ai #shorts'`, and hashtags `['#Shorts']` add nothing.
    - `description is caption, blank line, hashtags`: `'Cap'` and `['#a','#b']` give `'Cap\n\n#a #b #shorts'`.
    - `tags merge hashtags without # and preset tags, de-duplicated case-insensitively, within 500`: 60 long tags give `tagsLength(tags) <= 500`, and order is kept.
    - `tagsLength counts commas between tags and quotes around tags with spaces`: `tagsLength(['a b','c']) === 7`.
    - `defaultPreset maps the seven styles and falls back to 24`: check each pair from Global Constraints, and `'unknown'` → `'24'`.
    - `cleanDetails refuses an empty title, a bad privacy or a non-numeric category, and trims the rest`.
  - `schedule.test.ts`:
    - `due after post time on a listed day`: `Asia/Kolkata`, 18:00, now 2026-11-13T12:31Z (18:01 IST) → true; 12:29Z → false.
    - `not due on an unlisted day, when paused, or before hold_until`.
    - `not due when the schedule already posted today`: `lastScheduledAt` at 12:35Z the same IST day → false.
    - `a post at 23:50 yesterday in America/New_York does not block today`.
    - `nextSlot skips unlisted days and today once posted`: Fri 18:00, `days=[1]`, gives the next Monday 18:00 local as a UTC instant.
    - `nextDayStart gives local midnight of the next day`.
- [ ] **Step 2: Run** `pnpm vitest run lib/youtube`. The new tests should fail.
- [ ] **Step 3: Implement.** Build `localDay` on `Intl.DateTimeFormat(…, { timeZone, hourCycle: 'h23' }).formatToParts`. Look at `monthStartIn` in `lib/shorts/rules.ts` and reuse its approach for turning a local wall time into a UTC instant.
- [ ] **Step 4: Run** `pnpm vitest run lib/youtube`. Expected: PASS.
- [ ] **Step 5: Commit** `"YouTube: details, due check and next slot"`.

### Task 3: Connecting YouTube

**Files:**
- Create: `lib/youtube/google.ts` (server-only)
- Create: `lib/youtube/connection.ts` (server-only)
- Create: `app/auth/youtube/start/route.ts`, `app/auth/youtube/callback/route.ts`
- Modify:
  - `lib/social/connections.ts`: the platform type also allows `'youtube'`;
  - `lib/social/connect-notice.ts`: `youtube-(connected|cancelled|failed|not-configured|needs-https|no-channel)`;
  - `components/settings/social-connections.tsx`: a YouTube row;
  - `app/social/connection-actions.ts`: YouTube disconnect;
  - `app/(orbis)/active/page.tsx`: `configured.youtube`;
  - `lib/security/admin-usage.test.ts` and `docs/security/service-role-uses.md`.
- Test: `lib/youtube/google.test.ts`, `lib/social/connect-notice.test.ts` (extend it if it exists, otherwise create it)

**Interfaces:**
- Produces in `google.ts`:
  - `YOUTUBE_SCOPES`;
  - `youtubeConfigured(): boolean`, true when the client id and secret are set and `credentialEncryptionReady()`;
  - `youtubeAuthUrl(site: string, state: string): string`;
  - `exchangeYouTubeCode(code: string, site: string): Promise<{ accessToken: string; refreshToken: string | null }>`;
  - `mintAccessToken(refreshToken: string): Promise<string>`;
  - `getChannel(accessToken: string): Promise<{ id: string; title: string } | null>`;
  - `revokeGoogleToken(token: string): Promise<void>` (best effort);
  - `class YouTubeAuthError extends Error { reconnect: boolean }`, where `invalid_grant` gives `reconnect = true`.
  - Every fetch has `cache: 'no-store'`. Each function takes an optional last argument `fetchImpl = fetch`, for tests.
- Produces in `connection.ts`:
  - `saveYouTubeConnection(userId, channel: { id; title }, tokens: { accessToken; refreshToken: string | null })`. When the refresh token is null and the stored row has the same channel id, it keeps the stored one. Otherwise it throws `YouTubeAuthError('Google didn’t give Orbis offline access. Connect again and allow access.')`.
  - `getYouTubeConnection(admin, userId): Promise<YouTubeConnection>`;
  - `getYouTubeRefreshToken(admin, userId): Promise<string | null>`, null when missing, needing a reconnect, or undecryptable;
  - `markYouTubeReconnect(admin, userId)`;
  - `recordYouTubePublish(admin, userId)`;
  - `disconnectYouTube(userId)`, which revokes the refresh token (best effort) and then deletes the row.
- The routes mirror `app/auth/social/[platform]/{start,callback}/route.ts` line for line:
  - canonical host;
  - signed-in and unlocked;
  - `signState(userId, 'youtube')`;
  - cookie `orbis-youtube-oauth-state` on path `/auth/youtube`;
  - not configured → `youtube-not-configured`;
  - not HTTPS → `youtube-needs-https`;
  - the callback verifies with purpose `'youtube'`, exchanges the code, calls `getChannel`, then saves;
  - no channel → `youtube-no-channel`, nothing stored.
  - Both redirect to `/?tab=social&social=youtube-<outcome>`.

- [ ] **Step 1: Write the failing tests.**
  - `google.test.ts`:
    - `youtubeAuthUrl asks for upload and readonly, offline, consent, with the callback under the site`: parse the URL and assert `scope`, `access_type`, `prompt`, `redirect_uri === 'https://x.test/auth/youtube/callback'` and `state`.
    - `mintAccessToken throws a reconnect error on invalid_grant`, using a fake fetch that returns 400 `{ error: 'invalid_grant' }`.
    - `getChannel returns null when the account has no channel`: `{ items: [] }` → null, and `{ items: [{ id: 'UC1', snippet: { title: 'T' } }] }` → `{ id: 'UC1', title: 'T' }`.
  - `connect-notice.test.ts`: `youtube-no-channel says the Google account has no YouTube channel`, and `youtube-connected` gives a success tone.
- [ ] **Step 2: Run** `pnpm vitest run lib/youtube/google.test.ts lib/social`. The new tests should fail.
- [ ] **Step 3: Implement `google.ts` and `connection.ts`, the two routes, and the notice.** The `no-channel` copy: "That Google account has no YouTube channel. Create one at youtube.com, then connect again." `not-configured` names `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`. `needs-https` says that Google needs an HTTPS address.
- [ ] **Step 4: Add the Settings row** in `social-connections.tsx`. Add a YouTube entry with detail "Upload your shorts on a schedule", `href` `/auth/youtube/start`, and the not-configured note naming `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`. Show the channel title without the `@` prefix. Its expired note reads "Google stopped accepting Orbis’s access. Connect again." Add `BrandMark id="youtube"` if `components/settings/brand-mark.tsx` lacks it.
  - `disconnectSocialAction` accepts `'youtube'` and calls `disconnectYouTube`, with the message "YouTube disconnected. Videos already on your channel stay there. Queued shorts wait until you connect again."
  - `page.tsx` passes `youtube: youtubeConfigured()`.
- [ ] **Step 5: Allowlist.** Add `lib/youtube/connection.ts` to the allowlist and a doc row: "YouTube connection: stores and reads the encrypted refresh token in `social_connections` (no browser grants)".
- [ ] **Step 6: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 7: Commit** `"YouTube: connect, disconnect and the Settings row"`.

### Task 4: Repository, upload engine and the publish route

**Files:**
- Create: `lib/youtube/rows.ts` (client-safe row readers)
- Create: `lib/youtube/repository.ts` (server-only)
- Create: `lib/youtube/upload.ts` (pure, with injected I/O)
- Create: `lib/youtube/publish.ts` (server-only)
- Create: `app/api/social/youtube/publish/route.ts`
- Test: `lib/youtube/upload.test.ts`, `lib/youtube/repository.test.ts` (PGlite, through the Task 1 harness), `lib/youtube/publish.test.ts`
- Modify: the allowlist and doc (`app/api/social/youtube/publish/route.ts`, `lib/youtube/repository.ts`, `lib/youtube/publish.ts`)

**Interfaces:**
- Consumes:
  - Task 2's `isDue`, `nextDayStart`, `MAX_ATTEMPTS` and types;
  - Task 3's `mintAccessToken`, `YouTubeAuthError`, `getYouTubeRefreshToken`, `markYouTubeReconnect`, `recordYouTubePublish`.
- Produces in `upload.ts`:
  ```ts
  export const CHUNK = 8 * 1024 * 1024;
  export type UploadIo = {
    readRange(start: number, endInclusive: number): Promise<{ bytes: Uint8Array; total: number } | null>; // null: object missing
    fetch: typeof fetch;
    now(): number;
    save(patch: { uploadUrl?: string | null; bytesSent?: number }): Promise<void>;
  };
  export type UploadRow = { uploadUrl: string | null; bytesSent: number } & VideoDetails;
  export type UploadOutcome =
    | { kind: 'done'; youtubeId: string; privacy: Privacy }
    | { kind: 'partial' }
    | { kind: 'restart' }            // session 404/410: url and bytes cleared
    | { kind: 'reconnect' }          // 401
    | { kind: 'quota' }              // 403 quotaExceeded | uploadLimitExceeded
    | { kind: 'missing' }            // no object, or 0 bytes
    | { kind: 'error'; message: string };
  export function runUpload(row: UploadRow, accessToken: string, deadline: number, io: UploadIo): Promise<UploadOutcome>;
  ```
- Produces in `repository.ts`:
  - `getSchedule(admin, userId): Promise<Schedule>` creates the row on first read (R2);
  - `saveSchedule(admin, userId, schedule)`;
  - `getPreset(admin, userId, style): Promise<Preset>` seeds from `defaultPreset` on first read;
  - `listQueue(admin, userId)` returns active items by position;
  - `listPosted(admin, userId, 20)` returns `published` and `failed` by `published_at`/`updated_at`, newest first;
  - `insertQueued(admin, userId, input: { jobId: string | null; videoPath; coverPath } & VideoDetails)`;
  - `updateQueued(admin, userId, id, details)` works only while `queued`;
  - `moveQueued(admin, userId, id, dir: -1 | 1)` swaps positions with the neighbour;
  - `removeQueued(admin, userId, id)` sets `status = 'removed'`, only while `queued` or `failed`;
  - `retryFailed(admin, userId, id)` sets `queued`, `attempts = 0`, error null and `position = min − 1`;
  - `takeRow(admin, userId, id, from: 'queued' | 'uploading', postedBy?: 'schedule' | 'manual'): Promise<QueueRowFull | null>` is the lease from R3, with the guarded update in one statement;
  - `release(admin, id, patch)` clears the lease and applies the patch;
  - `lastScheduledAt(admin, userId)`;
  - `usersWithWork(admin): Promise<string[]>`, the users with any `queued` or `uploading` row and a connected YouTube.
- Produces in `publish.ts`:
  - `publishSlice(admin, userId, opts: { rowId?: string; postedBy: 'schedule' | 'manual'; deadline: number; now: Date }): Promise<'none' | 'partial' | 'published' | 'held' | 'reconnect' | 'failed' | 'retry'>`;
  - `publishDue(admin, now: Date, deadline: number): Promise<{ users: number; published: number; partial: number }>`.
- Route: `POST`, `cronAuthorized` or 401; `maxDuration = 60`; time budget 50 s; 204 when nothing was done; JSON counts otherwise; 500 with a plain message on a throw.

Behaviour that `runUpload` and `publishSlice` must follow. These are the spec's steps 2–5 plus R3–R5:

1. **No `uploadUrl`.**
   - `readRange(0,0)` gives `total`. Null or 0 → `missing`.
   - Then `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with these headers:
     - `Authorization: Bearer`;
     - `Content-Type: application/json; charset=UTF-8`;
     - `X-Upload-Content-Type: video/mp4`;
     - `X-Upload-Content-Length: <total>`.
   - Body: `{ snippet: { title, description, tags, categoryId, defaultLanguage: 'en' }, status: { privacyStatus, selfDeclaredMadeForKids, embeddable: true } }`.
   - Save the `Location` header as `uploadUrl`.
2. **Sending chunks.** Loop while `now() < deadline`:
   - read `[bytesSent, min(bytesSent+CHUNK, total)-1]`;
   - `PUT uploadUrl` with `Content-Range: bytes <start>-<end>/<total>`.
   - 308: the next `bytesSent` is the `Range` header's end + 1, or 0 when there is no `Range`. Save it.
   - 200/201: the JSON body gives `id` and `status.privacyStatus` → `done`.
3. **Errors.**
   - 404/410 on a PUT → save `{ uploadUrl: null, bytesSent: 0 }` → `restart`.
   - 401 → `reconnect`.
   - 403 whose `error.errors[0].reason` is `quotaExceeded` or `uploadLimitExceeded` → `quota`.
   - Any other non-OK response, or a fetch throw → `error` with `"YouTube said <status>: <message>"`, cut to 500.
4. **`publishSlice`.** Order:
   - (R4) resume an `uploading` row with a free lease, if there is one;
   - otherwise, `rowId` when given (manual);
   - otherwise, when `isDue` (with `lastScheduledAt`), the lowest-position `queued` row.
   
   Then take the row, get the refresh token (none → `reconnect` and mark), mint a token (`YouTubeAuthError.reconnect` → mark and `reconnect`), sign a URL for `video_path` (only under `<userId>/`), and build `readRange` with `fetch(signedUrl, { headers: { Range } })`. Read `total` from `Content-Range`; 404/400 means missing. Map the outcome:
   - `done` → `published`, with `published_at`, `published_privacy`, `youtube_id`, then `recordYouTubePublish`;
   - `partial` → keep `uploading`;
   - `restart` → keep `uploading`;
   - `reconnect` → back to `queued` if `bytesSent` is 0, else keep `uploading`; mark the connection;
   - `quota` → `queued`, set `hold_until` to `nextDayStart` (R5), error "YouTube’s daily upload limit was reached. Trying again on the next posting day.";
   - `missing` → `failed`, error "video file missing";
   - `error` → `attempts + 1`; at `MAX_ATTEMPTS` → `failed`, else `queued` with `upload_url` and `bytes_sent` reset.
   
   Always `release` the lease.

- [ ] **Step 1: Write the failing tests.**
  - `upload.test.ts`. Use a fake `io`, with fetch scripted per URL and method, over a byte array:
    - `one run uploads a small file and returns done with the id and privacy`;
    - `resumes from bytesSent with the right Content-Range`;
    - `stops with partial when the deadline passes and saves bytesSent`;
    - `a file of exactly 16 MB sends two chunks, the last ending at 16777215/16777216`;
    - `a 0-byte or missing object is missing without calling YouTube`;
    - `session 404 clears the url and returns restart`;
    - `403 quotaExceeded returns quota`;
    - `401 returns reconnect`;
    - `500 returns error with the message cut to 500`;
    - `308 without a Range header restarts from 0`.
  - `repository.test.ts` (PGlite with a minimal admin shim, or test the SQL of `takeRow` directly):
    - `takeRow on a row whose lease is live returns null` (Review Focus 2);
    - `takeRow moves queued to uploading and sets posted_by once`;
    - `moveQueued swaps with the neighbour and is a no-op at the ends`;
    - `retryFailed puts the row first with attempts 0`.
  - `publish.test.ts`. Fake the repository and Google modules with `vi.mock`:
    - `not due and nothing uploading does nothing`;
    - `an uploading row is resumed even when not due` (R4);
    - `quota sets hold_until to the next local day and keeps the row queued`;
    - `the third error fails the row`;
    - `invalid_grant marks reconnect and leaves the row queued`.
  - Route: test `cronAuthorized` gating through the existing pattern only if a route test pattern exists; otherwise rely on the `publish.ts` tests and a manual curl at review time.
- [ ] **Step 2: Run** `pnpm vitest run lib/youtube`. The new tests should fail.
- [ ] **Step 3: Implement** `rows.ts`, `repository.ts`, `upload.ts`, `publish.ts` and the route. If the repository reads hit a missing table, return empty or not-ready values (use `isMissingTable`), never a crash.
- [ ] **Step 4: Allowlist and doc rows.** The route and publish: "YouTube publish (cron): reads every person's due queue and uploads their videos from the `shorts` bucket; CRON_SECRET only". The repository: "YouTube queue, settings and presets: writes keyed to the signed-in person or, from the cron, the row's owner".
- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 6: Commit** `"YouTube: resumable upload engine, publisher and cron route"`.

### Task 5: Server actions and the delete guard

**Files:**
- Create: `app/shorts/youtube-actions.ts`
- Modify:
  - `app/shorts/actions.ts`: the R6 guard in `deleteShortAction`;
  - `lib/youtube/repository.ts`: add `activeQueueFor(admin, userId, jobIds: string[]): Promise<Record<string, { status: QueueStatus; youtubeId: string | null }>>` and `hasActiveQueue(admin, userId, jobId): Promise<boolean>`;
  - the allowlist and doc row for `app/shorts/youtube-actions.ts`.
- Test: `lib/youtube/actions-input.test.ts` covers the pure input readers the actions use (`readMove`, `readSchedule`).

**Interfaces:**
- Produces in `app/shorts/youtube-actions.ts`. Every action uses `requireUser()` and the `Result<T>` shape from `lib/shorts/view.ts`, and every id passes `isUuid`.
  - `loadYouTubePanelAction(): Result<YouTubePanel>`: covers are signed for `cover_path` under `<userId>/`, and `next` is a formatted "Fri 18:00 · <title>".
  - `draftForYouTubeAction(jobId): Result<VideoDetails>` reads the `done` job's delivery and the style's preset, then calls `buildDetails`.
  - `queueForYouTubeAction(jobId, details): Result<QueueItem>`:
    - the job is `done` with `delivery.files.video` under `<userId>/<jobId>/`;
    - the details pass `cleanDetails`;
    - a unique violation becomes "This short is already in your YouTube queue."
  - `updateQueueItemAction(id, details)`, `moveQueueItemAction(id, dir)`, `removeQueueItemAction(id)` and `retryQueueItemAction(id)` all return `Result<QueueItem[]>` (the fresh queue).
  - `postNowAction(id): Result<{ state: 'published' | 'partial' | 'held' | 'reconnect' | 'failed' | 'retry' }>` calls `publishSlice` with `postedBy: 'manual'`, `rowId` and a 45 s deadline. The page needs `maxDuration` 60: check `node_modules/next/dist/docs` for how a server action's duration is set in this Next version, and apply it.
  - `saveScheduleAction(input): Result<Schedule>`: time `HH:MM`, days a non-empty subset of 1–7, paused boolean, and the time zone checked with `Intl.supportedValuesOf('timeZone')`.
  - `ShortsView.youtube` (added to `lib/shorts/view.ts` and filled in `loadShortsViewAction`): `Record<jobId, { status; youtubeId }>` from `activeQueueFor`, for the Add to YouTube button state. If the table is missing, it is `{}`.

- [ ] **Step 1: Write the failing tests** in `actions-input.test.ts`:
  - `readSchedule refuses 24:00, an empty day list, day 8 and an unknown zone, and accepts Asia/Kolkata 18:00 [1..7]`;
  - `readMove accepts only -1 and 1`.
- [ ] **Step 2: Run** them. They should fail.
- [ ] **Step 3: Implement.** Put the readers in `lib/youtube/details.ts` (or a new `lib/youtube/input.ts`), then the actions and the R6 guard.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 5: Commit** `"YouTube: queue, schedule and post-now actions; keep queued shorts from being deleted"`.

### Task 6: The Shorts screens

**Files:**
- Create: `components/shorts/youtube-sheet.tsx`, `components/shorts/youtube-panel.tsx`
- Modify:
  - `components/shorts/library.tsx` (`ShortResult` gets the button or its state);
  - `components/shorts/shorts-view.tsx` (a "YouTube" section on home, between "Pick a style" and "Your shorts");
  - the Shorts stylesheet (find it with `grep -rln "sh-result" app/styles`).

**Interfaces:**
- Consumes the Task 5 actions and `ShortsView.youtube`.
- `YouTubeSheet({ initial: VideoDetails; onSave(details): Promise<string | null /* error */>; onClose })` has these fields:
  - title (with a live `n/100` counter);
  - description (`n/5000`);
  - tags (comma-separated, with a counter against 500);
  - category (a select from `CATEGORIES`);
  - privacy (select);
  - made for kids (checkbox).
  
  Its buttons are **Save to queue** / **Save** and Cancel. It is a native `<dialog>` and works at 360 px wide.
- `YouTubePanel({ onChanged })` has these parts, each as a section:
  - **Status line:** "Connect YouTube" links to `/auth/youtube/start` when not connected; a reconnect banner when it needs one. Otherwise it reads "<channel> · Next: Fri 18:00 · <title>", or "Paused", or "Queue empty".
  - **Queue:** each row has a cover, the title, ↑/↓ (`aria-label`s "Move up"/"Move down"), Edit, Remove and **Post now** (with a spinner and a result notice). "partial" reads "Uploading. It finishes on its own within 10 minutes."
  - **Schedule:** time input, seven day toggles (Mon–Sun), a Pause switch and Save.
  - **Posted:** the last 20, linking to `https://youtube.com/shorts/<id>`. Failed rows show the error and **Retry**. The privacy note from the spec (exact copy) shows when `publishedPrivacy === 'private'` and `privacy !== 'private'`.
- In `ShortResult`:
  - "Add to YouTube" opens the sheet from `draftForYouTubeAction`;
  - when the short is `queued` or `uploading`, it shows "In the YouTube queue" instead;
  - when it is `published`, it shows "On YouTube" with the link.
- Change the closing note in `shorts-view.tsx` from "nothing is posted for you" to "Nothing is posted until you add it to your YouTube queue."

- [ ] **Step 1: Build the sheet and the panel.** Follow the `sh-*` / `so-action` / `fd-*` class vocabulary already used in `components/shorts/*`. Keep the existing background (memory: the owner keeps the glow wallpaper on #0E0E10).
- [ ] **Step 2: Wire them in** `library.tsx` and `shorts-view.tsx`.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 4: Check it in the app.** Run the dev server from the worktree (follow the `run` skill). Open `#social/shorts` at 390×844 and at 1440×900. Screenshot the panel, the sheet and a finished short. With no migration applied locally, the panel must say it isn't set up yet and not crash.
- [ ] **Step 5: Commit** `"YouTube: Add to YouTube sheet and the YouTube panel in Shorts"`.

### Task 7: Import from the PC publisher, and owner docs

**Files:**
- Create: `workers/shorts-studio/src/import-youtube-queue.ts`
- Test: `workers/shorts-studio/src/import-youtube-queue.test.ts`
- Modify:
  - `workers/shorts-studio/package.json` (`"scripts": { "import-youtube-queue": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/import-youtube-queue.ts" }`);
  - `workers/shorts-studio/README.md` (a "Moving YouTube publishing into Orbis" section).
- Create: `docs/ops/youtube-owner-actions.md`

**Interfaces:**
- Consumes `loadConfig` (`src/config.ts`) and `createClient` the way `src/db.ts` does.
- Produces these pure functions, tested:
  - `readQueueFile(json: unknown): string[]`, where each entry is a project string or `{ project | dir | name }`;
  - `readPublished(json: unknown): Set<string>`, the same shapes;
  - `readYouTubeJson(json: unknown, fallbackTitle: string): VideoDetails`. It accepts `title`, `description`, `tags`, `categoryId | category_id`, `privacyStatus | privacy` and `madeForKids | made_for_kids`, and passes the result through `cleanDetails`.
  - `planImport(queue, published, alreadyQueuedPaths: Set<string>, owner): Array<{ project; videoPath; coverPath }>`. Paths are `<owner>/imported/<project>/video.mp4` and `cover.jpg`. It keeps queue order and skips published projects and queued paths.
- The PC publisher's real file formats are on the home PC, not in this repo, so the script **defaults to a dry run**. It prints what it would upload and insert, and writes only with `--apply`. Unreadable entries are listed and skipped, never guessed.

- [ ] **Step 1: Write the failing tests:**
  - `keeps queue order and skips published projects`;
  - `a re-run plans nothing when every video_path is already queued`;
  - `reads youtube.json in either key style and falls back to the folder name for a missing title`;
  - `an unreadable queue entry is skipped and reported`.
- [ ] **Step 2: Run** `pnpm vitest run workers/shorts-studio`. The new tests should fail.
- [ ] **Step 3: Implement the script.** `main` reads `~/faceless-shorts/publisher/{queue,published}.json`, picks each project's newest `renders/*.mp4` by mtime plus `renders/cover.jpg`, and uploads with `upsert: false`. It inserts rows with `position` continuing after the current max.
- [ ] **Step 4: Write `docs/ops/youtube-owner-actions.md`**, numbered, in this order:
  1. apply `202611130002_youtube.sql` in the SQL editor;
  2. confirm `https://orbis-starter.vercel.app/auth/youtube/callback` is on the Google web client;
  3. enable the YouTube Data API v3 in project `orbis-512912`;
  4. deploy;
  5. Settings → Connect YouTube;
  6. on the home PC: `git pull`, then `npm run import-youtube-queue` (dry run), then `-- --apply`;
  7. run `supabase/cron/youtube_schedule.sql`;
  8. the live check from the spec (queue one as private, Post now, confirm, delete);
  9. only then `systemctl --user disable --now yt-publish.timer`.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 6: Commit** `"YouTube: import the PC publisher's queue, and owner steps"`.
