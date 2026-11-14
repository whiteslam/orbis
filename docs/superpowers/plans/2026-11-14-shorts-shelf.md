# Shorts Shelf (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Shorts PC builds autopilot videos only at night, one at a time, until each platform has `shelf_days` days of posts ready. Failed builds are replaced within a daily cap. A health card shows whether the chain works. Google reconnects explain themselves, and a manual YouTube Retry can't double-post.

**Architecture:**
- Pure decisions live in `lib/shorts/shelf.ts` and `lib/shorts/health.ts`: window, shelf maths, destination choice, health lines.
- The PC worker (`workers/shorts-studio`) reads the counts and calls the pure decision. A guarded SQL function (`shorts_autopilot_start`) moves the day's counter, so a cap can't be overrun.
- The app reads the same tables for the Autopilot card and the health card.
- The YouTube posting path is untouched, except two small changes: a failed row keeps its session, and Retry asks that session first.

**Tech Stack:** Next.js server actions, Supabase (Postgres, PostgREST), Node 22 worker running TypeScript directly, vitest, PGlite SQL harness (`lib/youtube/sql-harness.ts`).

**Spec:** `docs/superpowers/specs/2026-11-14-shorts-shelf-and-reels-design.md` (Part 1 only; Part 2, Reels, gets its own plan).

## Global Constraints

- Branch `shorts-shelf`. Commit after every task, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files under `lib/shorts/` that the worker imports use **relative imports with `.ts` extensions** (the worker runs them with plain Node). Example: `lib/shorts/autopilot.ts` imports `'../locale/dates.ts'`.
- Defaults: build window **23:00–07:00**, shelf **3** days (1–7), destinations **`{youtube}`**, daily cap = **sum of posts per day across destinations + 1**.
- The migration sets the **existing** autopilot row's window to 23:00–07:00 as well.
- An autopilot job is identified by `options.autopilot === true`. Its target is `options.destination` (`'youtube' | 'instagram'`). A missing destination means `'youtube'`.
- "In progress" job statuses are `IN_FLIGHT` from `lib/shorts/rules.ts`: `queued`, `planning`, `plan_ready`, `building`.
- YouTube rows "on the shelf" are `youtube_queue.status in ('queued','uploading')`.
- Copy is plain British English, in the app's existing voice (curly apostrophes, as in the current files).
- Test command: `pnpm vitest run <paths>`. Type check: `pnpm typecheck`. Lint: `pnpm lint`.

## Review Focus

1. **A window that crosses midnight** (23:00–07:00): 23:30 and 06:59 are inside, 07:00 and 22:59 are outside, on the owner's clock (Asia/Kolkata), not UTC. Test in Task 2.
2. **Window start equal to end** (e.g. 00:00–00:00): it should mean "any time", not "never". Test in Task 2.
3. **YouTube not connected, or connection needs reconnecting:** the destination is left out, so nothing is built for it and the PC doesn't burn usage. Test in Task 2 (`pickDestination` gets no YouTube shelf) and Task 3 (`youtubeShelf` returns null).
4. **The daily cap across midnight:** a new local day resets the count to 1. The same day refuses once the cap is reached, and two calls can't both take the last slot. Test in Task 1.
5. **Retry when the session check itself fails** (network error or 5xx): Retry must not mark the row published. It requeues as today. Test in Task 7.

---

### Task 1: Migration: autopilot shelf columns, start guard, `connected_at`

**Files:**
- Create: `supabase/migrations/202611140002_shorts_shelf.sql`
- Test: `lib/shorts/shelf-migration.test.ts`

**Interfaces:**
- Produces, on `public.shorts_autopilot`:
  - `window_end time not null default '07:00'`
  - `shelf_days smallint not null default 3 check (shelf_days between 1 and 7)`
  - `destinations text[] not null default '{youtube}' check (cardinality(destinations) between 1 and 2 and destinations <@ array['youtube','instagram'])`
  - `started_on date`
  - `started_count smallint not null default 0 check (started_count between 0 and 50)`
  - `start_time` stays and **is** the window start. Its default changes to `'23:00'`, and existing rows are set to `start_time = '23:00', window_end = '07:00'`. That update must run only when the column is first added, so re-running the migration doesn't overwrite a later edit: do it inside a `do $$ … $$` block guarded by a check that `window_end` didn't exist yet.
- Produces `public.shorts_autopilot_start(p_user uuid, p_today date, p_cap integer) returns boolean`:
  - Security invoker, `search_path = ''`, executable by `service_role` only.
  - Is one `update … returning`. It moves `started_on` to `p_today` and sets `started_count` to 1 on a new day, or to +1 on the same day while `< p_cap`.
  - Matches only when `enabled`. Returns whether a row was updated.
- Produces `connected_at timestamptz` on `public.social_connections` and `public.gmail_connections`, via `alter table if exists … add column if not exists`.

- [ ] **Step 1: Write the failing tests** in `lib/shorts/shelf-migration.test.ts`. Follow `lib/shorts/autopilot-migration.test.ts`: boot with `bootDb()`, run `202611140001_shorts_autopilot.sql`, insert a row for `USER_A` with `start_time = '09:00'`, then run the new migration.
  - `the existing row moves to a 23:00–07:00 window, 3 days, YouTube`: selects `start_time::text, window_end::text, shelf_days, destinations` → `'23:00:00', '07:00:00', 3, ['youtube']`.
  - `re-running the migration keeps a later window`: update `start_time = '22:00'`, run the migration again, expect `'22:00:00'`.
  - `the start guard counts per local day and stops at the cap`: with `enabled = true`, `select public.shorts_autopilot_start($1, '2026-11-14', 2)` returns `true, true, false`. Then for `'2026-11-15'` it returns `true`, and `started_count` is 1.
  - `the start guard refuses while off`: with `enabled = false` it returns `false`.
  - `bad values are refused`: `shelf_days = 0` and `destinations = '{tiktok}'` reject with `/check constraint/i`.
  - `people can't call the start guard`: under `asUser(db, USER_A, …)` the call rejects with `/permission denied/i`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run lib/shorts/shelf-migration.test.ts`. Expected: FAIL (the file `202611140002_shorts_shelf.sql` isn't found).

- [ ] **Step 3: Write `202611140002_shorts_shelf.sql`** with the columns, the guarded one-time update, the function, and `revoke all on function … from public, anon, authenticated; grant execute … to service_role;`. Add a header comment saying what it does and that it is safe to re-run.

- [ ] **Step 4: Run the tests and see them pass.** Run: `pnpm vitest run lib/shorts/shelf-migration.test.ts lib/shorts/autopilot-migration.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add supabase/migrations/202611140002_shorts_shelf.sql lib/shorts/shelf-migration.test.ts && git commit -m "Shorts shelf: migration for the build window, shelf days, destinations and a start guard"`

### Task 2: The autopilot model and the shelf decisions (pure)

**Files:**
- Modify: `lib/shorts/autopilot.ts` (type, defaults, row reading, input reading, options; remove `autopilotDueOn`)
- Create: `lib/shorts/shelf.ts`
- Modify: `lib/shorts/types.ts` (`ShortOptions.destination?`)
- Test: `lib/shorts/autopilot.test.ts` (update), `lib/shorts/shelf.test.ts` (new)

**Interfaces:**
- Produces in `lib/shorts/types.ts`: `export type Destination = 'youtube' | 'instagram';` and `ShortOptions.destination?: Destination`.
- Produces in `lib/shorts/autopilot.ts`:
  - `Autopilot = { enabled: boolean; style: string; windowStart: string; windowEnd: string; shelfDays: number; destinations: Destination[]; timezone: string; startedOn: string | null; startedCount: number }`. This replaces `startTime` and `lastRunOn`.
  - `defaultAutopilot(timezone)` → enabled `false`, `cozy-tales`, `'23:00'`, `'07:00'`, `3`, `['youtube']`, `null`, `0`.
  - `AUTOPILOT_COLUMNS = 'enabled,style,start_time,window_end,shelf_days,destinations,timezone,started_on,started_count'`
  - `readAutopilotRow(row: unknown, fallbackZone: string): Autopilot`. It reads `start_time` into `windowStart`. Any bad or missing field falls back to the default.
  - `readAutopilotInput(raw: unknown): { enabled: boolean; windowStart: string; windowEnd: string; shelfDays: number; destinations: Destination[] } | null`. It returns null on: a non-boolean `enabled`; times not matching `HH:MM` (00–23, 00–59); `shelfDays` not an integer 1–7; destinations empty, with unknowns, or with duplicates.
  - `autopilotOptions(defaultVoice: string, seconds: number, destination: Destination)`: as today, plus `destination`.
- Produces in `lib/shorts/shelf.ts` (pure, client-safe, relative imports):
  - `type ShelfCount = { destination: Destination; postsPerDay: number; onShelf: number }`
  - `inWindow(windowStart: string, windowEnd: string, now: Date, timeZone: string): boolean`. Start is inclusive and end exclusive. It wraps past midnight. `start === end` means always.
  - `shelfDaysLeft(shelf: ShelfCount): number`, which is `onShelf / postsPerDay` (`postsPerDay` ≥ 1).
  - `dailyCap(shelves: ShelfCount[]): number`, which is the sum of `postsPerDay` + 1.
  - `pickDestination(shelves: ShelfCount[], shelfDays: number): Destination | null`. It picks the lowest `shelfDaysLeft` among shelves with `onShelf < shelfDays × postsPerDay`. A tie goes to `'youtube'`.
  - `type StartDecision = { today: string; destination: Destination; cap: number }`
  - `decideStart(input: { autopilot: Autopilot; now: Date; inProgress: number; shelves: ShelfCount[] }): StartDecision | null`. It returns null when: off; `inProgress > 0`; outside the window; or no destination below target. `shelves` holds only the switched-on, available destinations. `today` is `localDate(now, autopilot.timezone)`.

- [ ] **Step 1: Write the failing tests.**
  - In `lib/shorts/shelf.test.ts` (Asia/Kolkata; Sat 14 Nov 2026; 23:30 IST = `2026-11-14T18:00:00Z`):
    - `inWindow` with `'23:00','07:00'` is true at 23:30 and at 06:59 IST, and false at 07:00 and at 22:59 IST.
    - `inWindow('09:00','17:00', …)` is false at 08:59 and true at 09:00.
    - `inWindow('00:00','00:00', …)` is true at any time.
    - `dailyCap([{youtube, postsPerDay: 2, onShelf: 0}])` is 3.
    - `pickDestination` with YouTube `{2/day, 5}` and Instagram `{1/day, 1}` at shelfDays 3 gives `'instagram'` (1 day < 2.5 days). With both at 6 days it gives `null`. With equal days it gives `'youtube'`.
    - `decideStart` is null while `inProgress: 1`. It is null at 12:00 IST. It is null when `shelves` is `[]`. At 23:30 IST with an empty YouTube shelf it gives `{ today: '2026-11-14', destination: 'youtube', cap: 3 }` (2 posts a day). At 00:30 IST on the 15th, `today` is `'2026-11-15'`.
  - In `lib/shorts/autopilot.test.ts`: delete the `autopilotDueOn` tests. Add:
    - `readAutopilotRow` reads every new column and falls back on garbage (`shelf_days: 9` → 3; `destinations: ['tiktok']` → `['youtube']`).
    - `readAutopilotInput` accepts `{ enabled: true, windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'] }`. It returns null for each of: `windowEnd: '24:00'`, `shelfDays: 8`, `shelfDays: 2.5`, `destinations: []`, `destinations: ['youtube','youtube']`.
    - `autopilotOptions('am_michael', 45, 'youtube').destination` is `'youtube'`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run lib/shorts/shelf.test.ts lib/shorts/autopilot.test.ts`. Expected: FAIL (`./shelf` not found; `readAutopilotInput` not exported).

- [ ] **Step 3: Implement.** Write `lib/shorts/shelf.ts` and the `lib/shorts/autopilot.ts` changes. Use `localParts` / `localDate` from `'../locale/dates.ts'`, as `autopilot.ts` already does. Remove `autopilotDueOn`.

- [ ] **Step 4: Run the tests and the type check.** Run: `pnpm vitest run lib/shorts && pnpm typecheck`. The tests pass. The type check will list the call sites of `startTime`, `lastRunOn` and `autopilotDueOn` in `app/shorts/actions.ts`, `components/shorts/autopilot-card.tsx` and `workers/shorts-studio/src/autopilot.ts`; Tasks 3 and 4 fix those. Note the list and carry on.

- [ ] **Step 5: Commit.** `git commit -m "Shorts shelf: the build window, shelf maths and start decision"` (the files above).

### Task 3: The worker: start by shelf, take autopilot jobs only in the window

**Files:**
- Modify: `workers/shorts-studio/src/autopilot.ts`
- Modify: `workers/shorts-studio/src/db.ts` (`nextJob`)
- Modify: `workers/shorts-studio/src/main.ts` (the autopilot check and the `nextJob` call)
- Modify: `workers/shorts-studio/README.md` (the Autopilot section)
- Test: `workers/shorts-studio/src/autopilot.test.ts` (new), `workers/shorts-studio/src/run.test.ts` (update the fakes' method names)

**Interfaces:**
- Consumes: `decideStart`, `dailyCap`, `ShelfCount`, `inWindow` (Task 2); `readAutopilotRow`, `AUTOPILOT_COLUMNS`, `autopilotOptions(voice, seconds, destination)` (Task 2); `shorts_autopilot_start` (Task 1).
- Produces in `workers/shorts-studio/src/autopilot.ts`:
  - `AutopilotDb.startNext(owner: string, now: Date): Promise<{ topic: string; destination: Destination } | null>`. This replaces `startIfDue`.
  - `AutopilotDb.window(owner: string): Promise<{ windowStart: string; windowEnd: string; timezone: string } | null>`, which is null when off or missing.
  - Exported pure helper `youtubeShelf(input: { connection: { status: string } | null; postTimes: string[] | null; queued: number; building: number }): ShelfCount | null`. It is null when not connected or `status === 'reconnect_required'`. `postsPerDay` = `postTimes.length` (1 when null or empty). `onShelf` = `queued + building`.
- `startNext` steps:
  1. Read the row (`AUTOPILOT_COLUMNS`). A missing table means null.
  2. Count the owner's in-progress autopilot jobs: `status in IN_FLIGHT` and `options->>autopilot = 'true'`.
  3. Build the YouTube shelf, if `'youtube'` is in `destinations`. Read the `social_connections` youtube row status, `youtube_settings.post_times` (fall back to `post_time` as `lib/youtube/repository.ts` does), the count of `youtube_queue` rows in `queued`/`uploading`, and the in-progress autopilot jobs whose destination is youtube or missing. A missing YouTube table means no shelf.
  4. Call `decideStart`. On a decision, call `rpc('shorts_autopilot_start', { p_user, p_today: today, p_cap: cap })`. Only on `true`, insert the job, as today, with `autopilotOptions(voice, seconds, destination)`.
- `WorkerDb.nextJob(owner: string, opts: { autopilot: boolean }): Promise<JobRow | null>`. When `opts.autopilot` is false, it skips jobs whose `options->>autopilot` is `'true'` (PostgREST: `.or('options->>autopilot.is.null,options->>autopilot.neq.true')`).
- `main.ts`: each loop reads `autopilot.window(owner)` at most once a minute (cache it alongside `lastAutopilotCheck`). It passes `{ autopilot: !window || inWindow(window.windowStart, window.windowEnd, new Date(), window.timezone) }` to `nextJob`. A missing window (autopilot off) lets any job through. It calls `startNext` where `startIfDue` was, and logs `Autopilot queued (<destination>): <topic>`.

- [ ] **Step 1: Write the failing tests** in `workers/shorts-studio/src/autopilot.test.ts`, for `youtubeShelf`:
  - It is null with no connection.
  - It is null with `status: 'reconnect_required'`.
  - `{ connected, postTimes: ['09:00','18:00'], queued: 3, building: 1 }` gives `{ destination: 'youtube', postsPerDay: 2, onShelf: 4 }`.
  - `postTimes: null` gives `postsPerDay: 1`.

  In `run.test.ts`, rename the fake's `startIfDue` to `startNext` and add a `window` stub returning `null`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run workers/shorts-studio`. Expected: FAIL (`youtubeShelf` not exported).

- [ ] **Step 3: Implement** `youtubeShelf`, `startNext`, `window`, `nextJob(owner, opts)` and the `main.ts` changes. Then update the README's Autopilot section, covering:
  - it builds between the window times, one at a time;
  - it keeps "Keep ready" days of posts on the shelf;
  - a failed build is replaced, within posts-per-day + 1 a day;
  - the PC must stay awake in the window.

- [ ] **Step 4: Run the tests.** Run: `pnpm vitest run workers/shorts-studio lib/shorts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Shorts worker: build by the shelf, one at a time, only in the night window"`

### Task 4: The Autopilot card and its actions

**Files:**
- Modify: `app/shorts/actions.ts` (`loadAutopilotAction`, `saveAutopilotAction`)
- Modify: `components/shorts/autopilot-card.tsx`
- Modify: `app/styles/page-shorts.css` (only what the new fields need)

**Interfaces:**
- Consumes: `AUTOPILOT_COLUMNS`, `readAutopilotRow`, `readAutopilotInput`, `Autopilot` (Task 2).
- `loadAutopilotAction(): Result<{ autopilot: Autopilot; ready: boolean }>`, as today. It selects `AUTOPILOT_COLUMNS`. If only the new columns are missing (code `42703`), it returns `ready: false`.
- `saveAutopilotAction(input: unknown): Result<Autopilot>`. Bad input → `fail('Check the build window and the days to keep ready.')`. It upserts `enabled, start_time: windowStart, window_end, shelf_days, destinations, timezone, style`. It never writes `started_on` or `started_count`. A missing migration → `fail('The autopilot needs its migrations in Supabase first (202611140001 and 202611140002).')`.
- Card copy:
  - Title: **Bedtime stories on autopilot**.
  - Sub-line: "Made overnight on your Shorts PC and posted by your YouTube schedule."
  - Fields:
    - **Build between** [from] **and** [to];
    - **Keep ready** [1–7] **days**;
    - **Post to**: a YouTube switch. The Instagram switch arrives with Part 2, so don't render it yet.
  - The footer line, when on: "Builds one at a time between {from} and {to} while your Shorts PC is awake, until {n} days of posts are ready." Use `timeLabel`.
- Save stays as today: the switch saves at once; the other fields show **Save** when changed.

- [ ] **Step 1: Make the type check pass for these two files** (no new unit test: the input rules are tested in Task 2). Run: `pnpm typecheck`. Expected: no errors in `app/shorts/actions.ts` or `components/shorts/autopilot-card.tsx`.

- [ ] **Step 2: Check it in the browser.** Run the dev server (`npx next dev -p 3100`), sign in, and open Social → Shorts.
  - Before the migration: the card says it needs the migrations.
  - After applying both autopilot migrations locally (or with the remote tables present): change the window to 22:00–06:00 and Keep ready to 2, then save. Reloading keeps the values.

- [ ] **Step 3: Commit.** `git commit -m "Autopilot card: build window, days to keep ready, where to post"`

### Task 5: The health card

**Files:**
- Create: `lib/shorts/health.ts`
- Create: `components/shorts/health-card.tsx`
- Modify: `app/shorts/actions.ts` (new `loadShortsHealthAction`)
- Modify: `components/shorts/shorts-view.tsx` (render `<HealthCard />` first, above the worker strip)
- Modify: `app/styles/page-shorts.css`
- Test: `lib/shorts/health.test.ts`

**Interfaces:**
- Consumes: `workerPresence` (`lib/shorts/rules.ts`), `nextSlot` and `dayStart` (`lib/youtube/schedule.ts`), `getYouTubeConnection`, `getSchedule`, `scheduledSince` (`lib/youtube/*`), `shelfDaysLeft` (Task 2).
- Produces in `lib/shorts/health.ts` (pure):
  - `type HealthInput = { now: Date; worker: { presence: WorkerPresence; note: string | null; lastSeen: string | null }; youtube: { state: 'not_set_up' | 'not_connected' | 'reconnect' | 'connected'; onShelf: number; postsPerDay: number; nextPost: Date | null; paused: boolean; holdUntil: string | null; timeZone: string }; failedBuilds24h: number; failedPosts24h: number }`
  - `type HealthLine = { key: 'shelf' | 'next' | 'pc' | 'accounts' | 'problems'; label: string; text: string; tone: 'ok' | 'warn' | 'bad' }`
  - `shortsHealth(input: HealthInput): HealthLine[]`, always in the order shelf, next, pc, accounts, problems.
- Wording `shortsHealth` must produce:
  - **shelf:** `YouTube {n} · about {d} days`. `d` is rounded down to the nearest half and written with `½` (2.5 → `2½`, 0.5 → `½`). It reads `about 1 day` for 1. The tone is `warn` when under 1 day.
  - **next:** `YouTube {Today|Tomorrow|Fri} {h:mm am/pm}`, on the schedule's zone. `Paused` when paused. `—` when there's nothing to post.
  - **pc:**
    - online with a note: `Online · {note}`;
    - idle: `Online`;
    - offline: `Offline since {time}`, tone `bad`;
    - none: `Not set up`, tone `warn`.
  - **accounts:**
    - connected: `YouTube connected`;
    - reconnect: `YouTube needs connecting again`, tone `bad`;
    - not connected or not set up: `YouTube not connected`, tone `warn`.
  - **problems:**
    - nothing wrong: `None in the last 24 h`;
    - otherwise the parts joined by ` · `: `{n} build(s) failed`, `{n} post(s) failed`, `YouTube daily limit hit` (when `holdUntil > now`). Tone `warn`.
- `loadShortsHealthAction(): Result<HealthLine[]>` reads, for the signed-in person:
  - the worker;
  - the YouTube connection, schedule and today's count, as `loadYouTubePanelAction` does;
  - `onShelf` = `youtube_queue` rows `queued`/`uploading` + in-progress autopilot jobs for YouTube;
  - `failedBuilds24h` = `shorts_jobs` with `status = 'failed'` and `finished_at` within 24 h;
  - `failedPosts24h` = `youtube_queue` with `status = 'failed'` and `updated_at` within 24 h.

  Missing YouTube tables → `state: 'not_set_up'`.
- `HealthCard` loads on mount and when the view refreshes (follow how `AutopilotCard` loads). It shows the five lines as a two-column list (label | text), and the tone sets a class (`sh-health-warn`, `sh-health-bad`).

- [ ] **Step 1: Write the failing tests** in `lib/shorts/health.test.ts`. One test per wording rule above:
  - 5 videos at 2 a day → `YouTube 5 · about 2½ days`, `ok`;
  - 1 video at 2 a day → `about ½ day`, `warn`;
  - paused → next `Paused`;
  - offline → `bad`;
  - reconnect → accounts `bad`;
  - no problems → `None in the last 24 h`;
  - 2 failed builds + hold → `2 builds failed · YouTube daily limit hit`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run lib/shorts/health.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `shortsHealth`, the action, the card and its styles. Match the existing Shorts tab look (`sh-*` classes, fd tokens).

- [ ] **Step 4: Run the tests and the type check.** Run: `pnpm vitest run lib/shorts && pnpm typecheck`. Expected: PASS, no errors. Then open Social → Shorts in the browser: the card sits at the top with five lines.

- [ ] **Step 5: Commit.** `git commit -m "Shorts: a health card for the shelf, next post, PC, accounts and problems"`

### Task 6: Google reconnects explain themselves, and remember when they connected

**Files:**
- Create: `lib/providers/google-hint.ts` (client-safe)
- Modify: `components/shorts/youtube-panel.tsx` (reconnect banner)
- Modify: `components/settings/app-integrations.tsx` (Google row, when it needs reconnecting)
- Modify: `components/settings/social-connections.tsx` (YouTube row, when expired, if it shows one)
- Modify: `lib/youtube/connection.ts` (`saveYouTubeConnection` sets `connected_at`)
- Modify: `lib/gmail/oauth.ts` (`saveGmailConnection` sets `connected_at`)
- Modify: `docs/ops/youtube-owner-actions.md` (the publishing status must be In production)
- Test: `lib/youtube/connection.test.ts`

**Interfaces:**
- Produces `GOOGLE_RECONNECT_HINT = 'If this keeps happening about a week after each connect, your Google app is in Testing: publish it in Google Cloud → Google Auth Platform → Audience.'`
- YouTube banner text: `Google ended Orbis’s access, so YouTube needs connecting again. ` + hint, with the existing **Connect again** link.
- Settings Google row, when it needs reconnecting: the hint as its detail line, under the existing button.
- `saveYouTubeConnection` adds `connected_at: new Date().toISOString()` to the upsert. On `42703`, it retries once without `connected_at`, as `saveGmailConnection` already does for `granted_scopes`. `saveGmailConnection` adds it the same way.

- [ ] **Step 1: Write the failing test** in `lib/youtube/connection.test.ts`: `saving stamps connected_at`. The saved upsert has a `connected_at` ISO string. Update the existing "stores both tokens…" expectation for the new field.

- [ ] **Step 2: Run it and see it fail.** Run: `pnpm vitest run lib/youtube/connection.test.ts`. Expected: FAIL (no `connected_at`).

- [ ] **Step 3: Implement** the hint, the copy, both saves and the doc line.

- [ ] **Step 4: Run the tests and the type check.** Run: `pnpm vitest run lib/youtube lib/gmail && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Google reconnects: say why, and remember when each connection was made"`

### Task 7: A manual YouTube Retry never posts twice

**Files:**
- Modify: `lib/youtube/upload.ts` (export `askSession`)
- Modify: `lib/youtube/publish.ts` (`countError` keeps the session on the final failure; new `settleFailedRow`)
- Modify: `lib/youtube/repository.ts` (`retryFailed` reads nothing new; it still clears the session)
- Modify: `app/shorts/youtube-actions.ts` (`retryQueueItemAction` settles first)
- Modify: `components/shorts/youtube-panel.tsx` or `youtube-sheet.tsx`, wherever Retry's result is shown
- Test: `lib/youtube/upload.test.ts`, `lib/youtube/publish.test.ts`

**Interfaces:**
- Produces in `upload.ts`: `askSession(uploadUrl: string, accessToken: string, row: UploadRow, io: UploadIo): Promise<{ kind: 'done'; youtubeId: string; privacy: Privacy } | { kind: 'unfinished' }>`.
  - It reads the total with `io.readRange(0, 0)`, then PUTs `bytes */{total}` with the existing `put`.
  - 200/201 → `finished(…)`; if that yields `done`, return it.
  - Anything else, including a thrown error, a missing file, 308, 404/410 or 5xx → `{ kind: 'unfinished' }`.
- `publish.ts` `countError`: when `attempts >= MAX_ATTEMPTS` **and** there is a session, the patch is `{ status: 'failed', attempts, error: message }`, keeping `upload_url` and `bytes_sent`. Without a session, it stays as today.
- Produces in `publish.ts`: `settleFailedRow(admin: Admin, userId: string, id: string, deps?: { fetch?: typeof fetch }): Promise<'published' | 'requeue'>`.
  - It reads the row. If it isn't `failed`, or has no `upload_url` → `'requeue'`.
  - It gets the refresh token. If there is none, or minting fails → `'requeue'`.
  - It signs the video (`signVideo`); a failure → `'requeue'`.
  - `askSession(…, { readRange: rangeReader(url, fetch), fetch, now: Date.now, save: async () => {} })`.
  - `done` → update the row, guarded on `status = 'failed'`: `{ status: 'published', youtube_id, published_privacy, published_at: now, error: null, upload_url: null }`, then call `recordYouTubePublish` → `'published'`. Otherwise → `'requeue'`.
- `retryQueueItemAction(id)`: call `settleFailedRow` first. On `'published'`, return the refreshed queue and the message `It had already posted to YouTube, so it wasn’t uploaded again.` Otherwise call `retryFailed` as today.

- [ ] **Step 1: Write the failing tests.**
  - `upload.test.ts`:
    - `askSession says done when YouTube answers 201 with an id` (fake fetch: 201 `{ id: 'abc', status: { privacyStatus: 'public' } }`);
    - `askSession says unfinished on 308, 404 and a thrown fetch`.
  - `publish.test.ts`, following the file's existing fakes:
    - `a row failing its last attempt keeps its upload session`;
    - `settling a failed row whose session finished marks it published and never uploads` (assert no PUT with a body was made);
    - `settling a failed row whose session is unfinished asks to requeue and changes nothing`;
    - `settling when Google refuses the token asks to requeue` (Review Focus 5 covers the 5xx from YouTube: add it as a case of the unfinished test).

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run lib/youtube/upload.test.ts lib/youtube/publish.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `askSession`, the `countError` change, `settleFailedRow`, and the action and its message.

- [ ] **Step 4: Run all the YouTube tests.** Run: `pnpm vitest run lib/youtube`. Expected: PASS. Existing tests that asserted the final failure clears the session must be updated to the new rule. Change only those.

- [ ] **Step 5: Commit.** `git commit -m "YouTube Retry: ask the old upload first, so a lost answer never posts twice"`

### Task 8: Owner steps, full check

**Files:**
- Create: `docs/ops/shorts-autopilot-owner-actions.md`

**Interfaces:** none.

- [ ] **Step 1: Write the owner steps** (Part 1 only), as a numbered list:
  1. Apply `202611140002_shorts_shelf.sql` in Supabase (and `202611140001` first, if it isn't applied).
  2. Pull on the home PC and restart the worker (`systemctl --user restart orbis-shorts`).
  3. Keep the PC awake in the window: set suspend to never in the power settings. Check with `systemctl status sleep.target`.
  4. In Social → Shorts → Autopilot, set the window, Keep ready and the YouTube switch.
  5. In Google Cloud → Google Auth Platform → Audience, confirm the publishing status is **In production**.

- [ ] **Step 2: Run everything.** Run: `pnpm vitest run && pnpm typecheck && pnpm lint`. Expected: all pass (report any pre-existing failure separately, with its output).

- [ ] **Step 3: Commit.** `git commit -m "Docs: owner steps for the Shorts shelf"`
