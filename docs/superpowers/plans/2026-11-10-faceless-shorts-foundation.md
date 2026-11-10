# Faceless Shorts Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Shorts area in Social. The owner picks one of the skill's styles, queues a short, edits and approves its plan, and gets the finished MP4. A worker on the owner's PC drives `claude -p` with the `faceless-shorts` skill.

**Architecture:**
- **Orbis:** queues and reads only, through server actions and Supabase tables `shorts_*` (RLS read-own, service-role writes).
- **Worker:** `workers/shorts-studio` (Node 24, TypeScript run with `--experimental-strip-types`). It claims the owner's jobs, runs one Claude Code process per stage, maps its stream-json output to events, checks the outputs and uploads files to the private `shorts` bucket.
- **Shared code:** plan validation lives in one dependency-free file, `lib/shorts/plan.ts`. Both the app and the worker use it.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Supabase (Postgres, Storage, supabase-js 2), vitest, Node 24 child_process, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-10-faceless-shorts-foundation-design.md`

## Global Constraints

**Database**
- Migration file: `supabase/migrations/202611100001_shorts.sql`. Every table has RLS: `authenticated` may only `select` its own rows; all writes go through `service_role`.
- Job `status` values: `queued | planning | plan_ready | building | done | failed | cancelled`. Job `stage`: `plan | build`.
- Event `kind`: `status | step | log | qa`. Event `content` is at most 4000 characters.

**Job inputs**
- `topic`: at most 300 characters, control characters stripped.
- `options`: `{ seconds: 25..60, voice: /^[a-z]{2}_[a-z]+$/, mode: 'voice'|'captions', music: 'bed'|'none', endLine: ≤80 chars }`.

**Plan rules**
- Lines: 3–30. Line text: 1–300 characters. Shot description: ≤300 characters.
- Title: 1–120 characters. Sources: ≤12.
- Caption chunks: split on `|`; each chunk has 1–3 words and exactly one word starting with `*`.

**Limits and timing**
- At most 3 jobs in flight per user, and 30 jobs created per calendar month (IST).
- Storage bucket `shorts`: private, 200 MB per file, types `video/mp4 image/jpeg image/png application/json`. Paths are `<userId>/<jobId>/<file>`; style sheets go at `styles/<slug>.png`. Signed URLs last 1 hour.
- Worker:
  - claims only rows where `user_id = OWNER_USER_ID`;
  - heartbeat every 30 s; counts as offline after 120 s without one;
  - sweep: a `planning` or `building` job with no event for 60 min becomes `failed`;
  - timeouts: 15 min for the plan, 120 min for the build;
  - pauses claims for 30 min after a Claude login or usage-limit failure.
- UI polling: every 3 s while any job is active.

**Conventions**
- Copy style: plain sentences, curly apostrophes (’) in user-facing strings, as in the rest of the app.
- No new dependencies.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/202611100001_shorts.sql` | tables, RLS, bucket |
| `lib/account/deletion-plan.ts` (+test) | add the `shorts` bucket and export tables |
| `lib/shorts/plan.ts` (+test) | `ShortPlan` type, `parseCaps`, `validatePlan`. Pure, no imports (the worker uses it). |
| `lib/shorts/types.ts` | `ShortJob`, `ShortEvent`, `ShortStyle`, `WorkerState`, `ShortOptions`, `JobStatus` |
| `lib/shorts/rules.ts` (+test) | `cleanTopic`, `readOptions`, `workerPresence`, `canApprove/canRetry/canCancel`, `limitRefusal`, `isActive`, `mergeEvents` |
| `lib/shorts/rows.ts` (+test) | DB row → typed objects (`readJob`, `readEvent`, `readStyle`, `readWorker`) |
| `lib/shorts/repository.ts` | server-only Supabase reads and writes |
| `lib/shorts/view.ts` | `ShortsView`, `JobDetail`, `Result<T>` (client-safe) |
| `app/shorts/actions.ts` | server actions |
| `components/shorts/*.tsx` | UI: `shorts-view`, `worker-strip`, `style-board`, `intake`, `job-card`, `plan-editor`, `library` |
| `app/styles/page-shorts.css` | styles (imported in `app/(orbis)/layout.tsx`) |
| `components/social/social-screen.tsx` | the Planner/Shorts switch |
| `workers/shorts-studio/src/{config,styles,stream,prompts,script,outputs,db,claude,run,main}.ts` (+tests) | the worker |
| `workers/shorts-studio/{README.md,orbis-shorts.service,fake-claude.mjs}` | setup, systemd unit, test double |
| `vitest.config.ts` | also include `workers/shorts-studio/**/*.test.ts` |

---

### Task 1: Database and account data

**Files:** Create `supabase/migrations/202611100001_shorts.sql`. Modify `lib/account/deletion-plan.ts`, `lib/account/deletion-plan.test.ts`.

**Produces:** tables `shorts_jobs`, `shorts_events`, `shorts_styles` and `shorts_worker`, plus bucket `shorts`.

- [ ] **Step 1: Write the migration**
  - **`shorts_jobs`**:
    - columns: `id uuid pk`, `user_id`, `style text check (style ~ '^[a-z0-9-]{2,40}$')`, `topic`, `options jsonb`, `status`, `stage`, `plan jsonb`, `plan_feedback`, `delivery jsonb`, `error`, `attempt smallint default 1`, `started_at`, `finished_at`, `last_event_at`, `created_at`, `updated_at`;
    - `unique (user_id, id)`;
    - indexes on `(user_id, created_at desc)` and `(status) where status in ('queued','planning','building')`;
    - the `set_updated_at` trigger.
  - **`shorts_events`**: `id bigint identity`, `user_id`, `job_id`, `seq int`, `kind`, `content`, `at`; `unique (job_id, seq)`; FK `(user_id, job_id)` → jobs, on delete cascade.
  - **`shorts_styles`**: `slug pk`, `name`, `tagline`, `best_for`, `seconds_min`, `seconds_max`, `is_3d`, `default_voice`, `sheet_path`, `example_title`, `position`, `synced_at`. Select policy for any `authenticated` user.
  - **`shorts_worker`**: `user_id pk`, `last_seen`, `state check in ('idle','busy','paused','setup')`, `note`, `voices jsonb` (an array of `{id,label}`), `version`.
  - **Bucket** insert as specified, plus RLS policies following the research migration.
- [ ] **Step 2: Update `deletion-plan.ts`**
  - Add `'shorts'` to `STORAGE_BUCKETS`.
  - Add `'shorts_jobs'` to `EXPORT_TABLES`. Events are left out: they're progress noise and already covered by cascade.
  - In the test, assert that `shorts` is in `STORAGE_BUCKETS` and `shorts_jobs` is exported.
- [ ] **Step 3:** `pnpm vitest run lib/account` → PASS. Commit: "Add the Faceless Shorts tables and bucket".

### Task 2: Plan rules (`lib/shorts/plan.ts`)

**Produces:**
```ts
export type PlanLine = { text: string; caps: string; shot: string };
export type ShortPlan = { title: string; seconds: number; lines: PlanLine[]; sources: string[]; notes: string };
export type CapChunk = { words: string[]; keyword: number }; // index of the *word, -1 if none
export function parseCaps(caps: string): CapChunk[];
export function validatePlan(input: unknown): { ok: true; plan: ShortPlan } | { ok: false; errors: string[] };
export function wordCount(plan: ShortPlan): number;
```
- [ ] **Step 1: Write the failing tests** (`lib/shorts/plan.test.ts`):
  - `parseCaps('WHAT *HAPPENS | IF YOU *SWALLOW')` → 2 chunks, keyword indices 1 and 2.
  - A chunk with 4 words is an error: "Line 2, caption 1 has 4 words (1–3)".
  - A chunk with no `*` or with two `*` is an error.
  - 2 lines is an error; 31 lines is an error.
  - Missing title is an error. `seconds` 61 is an error.
  - A good plan (gum example, 3 lines) gives `ok` with the strings trimmed.
  - Non-object input gives `ok: false`.
  - `notes` and `sources` are optional and default to `''` and `[]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with only relative-free, dependency-free code. **Step 4:** PASS. Commit.

### Task 3: Shared types, rules and rows

**Produces** (`lib/shorts/types.ts`):
```ts
export type JobStatus = 'queued'|'planning'|'plan_ready'|'building'|'done'|'failed'|'cancelled';
export type JobStage = 'plan'|'build';
export type ShortOptions = { seconds: number; voice: string; mode: 'voice'|'captions'; music: 'bed'|'none'; endLine: string };
export type Delivery = { title: string; caption: string; hashtags: string[]; qa: string[]; seconds: number; files: { video: string; share: string|null; cover: string|null; sheet: string|null } };
export type ShortJob = { id: string; style: string; topic: string; options: ShortOptions; status: JobStatus; stage: JobStage; plan: ShortPlan|null; planFeedback: string|null; delivery: Delivery|null; error: string|null; attempt: number; createdAt: string; startedAt: string|null; finishedAt: string|null; lastEventAt: string|null };
export type ShortEvent = { seq: number; kind: 'status'|'step'|'log'|'qa'; content: string; at: string };
export type ShortStyle = { slug: string; name: string; tagline: string; bestFor: string; secondsMin: number; secondsMax: number; is3d: boolean; defaultVoice: string; sheetPath: string|null; exampleTitle: string; position: number };
export type Voice = { id: string; label: string };
export type WorkerState = { lastSeen: string|null; state: 'idle'|'busy'|'paused'|'setup'; note: string|null; voices: Voice[] };
export type WorkerPresence = 'none'|'offline'|'idle'|'busy'|'paused'|'setup';
```
**Produces** (`lib/shorts/rules.ts`, pure):
```ts
export const ACTIVE: JobStatus[]; // queued, planning, plan_ready, building
export const LIMITS = { inFlight: 3, perMonth: 30, topic: 300, endLine: 80, feedback: 1000 };
export function cleanTopic(raw: unknown): string | null;        // trims, strips control chars, collapses whitespace, null if empty or >300
export function readOptions(raw: unknown, style: Pick<ShortStyle,'secondsMin'|'secondsMax'|'defaultVoice'>): ShortOptions | null;
export function workerPresence(worker: WorkerState | null, now: Date): WorkerPresence; // offline when lastSeen > 120 s ago
export function canApprove(job: ShortJob): boolean;  // status plan_ready
export function canCancel(job: ShortJob): boolean;   // queued|planning|plan_ready|building
export function canRetry(job: ShortJob): boolean;    // failed
export function isActive(job: ShortJob): boolean;    // queued|planning|building (the ones being worked on)
export function limitRefusal(inFlight: number, thisMonth: number): string | null;
export function monthStartIst(now: Date): string;     // ISO of the 1st of this month 00:00 IST
export function mergeEvents(have: ShortEvent[], fresh: ShortEvent[]): ShortEvent[]; // dedupe by seq, sorted
```
**Produces** (`lib/shorts/rows.ts`): `readJob(row): ShortJob|null`, `readEvent`, `readStyle`, `readWorker`. Each tolerates bad JSON: an invalid `plan` becomes null and an invalid `delivery` becomes null.

- [ ] **Step 1: Write the failing tests** (`rules.test.ts`, `rows.test.ts`):
  - `cleanTopic`: `'  gum\u0007  '` → `'gum'`; 301 characters → null.
  - `readOptions`:
    - seconds are clamped into the style's range;
    - a voice like `'rm -rf'` falls back to the default;
    - an unknown mode becomes `'voice'`;
    - an end line is cut to 80 characters.
  - `workerPresence`: null → `none`; seen 3 min ago → `offline`; seen 10 s ago and busy → `busy`.
  - `limitRefusal(3, 0)` → the in-flight message; `(0, 30)` → the monthly message; `(2, 29)` → null.
  - `mergeEvents` dedupes and sorts.
  - `monthStartIst(new Date('2026-11-30T20:00:00Z'))` → `'2026-11-30T18:30:00.000Z'`. That instant is already Dec 1 in IST, so the expected value is the start of December.
  - `readJob` reads the snake_case row and drops a malformed plan.
- [ ] **Step 2:** FAIL → implement → PASS. Commit "Add the Shorts rules and row readers".

### Task 4: Repository, view and server actions

**Consumes:** Tasks 2–3. **Produces:**
```ts
// lib/shorts/view.ts
export type Result<T> = { success: true; data: T } | { success: false; message: string };
export type LibraryUrls = { video: string; share: string|null; cover: string|null; sheet: string|null };
export type ShortsView = { presence: WorkerPresence; worker: WorkerState|null; styles: (ShortStyle & { sheetUrl: string|null })[]; jobs: ShortJob[]; covers: Record<string, string>; monthUsed: number };
export type JobDetail = { job: ShortJob; events: ShortEvent[] };
// app/shorts/actions.ts ('use server')
loadShortsViewAction(): Promise<Result<ShortsView>>
loadJobAction(jobId: string, afterSeq: number): Promise<Result<JobDetail>>
queueShortAction(input: { style: string; topic: string; options: unknown }): Promise<Result<ShortJob>>
approvePlanAction(jobId: string, plan: unknown): Promise<Result<ShortJob>>
requestPlanChangesAction(jobId: string, feedback: string): Promise<Result<ShortJob>>
cancelJobAction(jobId: string): Promise<Result<ShortJob>>
retryJobAction(jobId: string): Promise<Result<ShortJob>>
deleteShortAction(jobId: string): Promise<Result<null>>
loadFilesAction(jobId: string): Promise<Result<LibraryUrls>>
```
**Rules:**
- **Every action:** calls `requireUser()` (on failure: "Sign in again to do this.") and checks `isUuid` for ids.
- **Reads:** go through the user's session (RLS).
- **Writes:** use `createAdminClient()` with a status guard, e.g. `.eq('user_id', userId).eq('id', jobId).in('status', [...])`. A zero-row update gives "This short has moved on. Reload and try again."
- **`queueShortAction`:**
  - refuses when there is no `shorts_worker` row: "Set up the Shorts worker on your PC first.";
  - refuses an unknown style;
  - applies `limitRefusal`.
- **`approvePlanAction`:** runs `validatePlan`. On failure it returns the first 3 errors joined.
- **`deleteShortAction`:** only for `done | failed | cancelled` jobs. It removes the storage objects under `<user>/<job>/`, then the row.
- **Signed URLs:** 3600 s, made with the admin client after confirming the job belongs to the user.
- [ ] Implement `repository.ts` (server-only), `view.ts` and `actions.ts`. Run `pnpm typecheck` → no errors. Commit "Add the Shorts server actions".

### Task 5: Worker, pure parts

**Files:** `workers/shorts-studio/src/{styles,stream,prompts,script,outputs}.ts` and tests. Add the worker glob to `vitest.config.ts`. Imports use relative `.ts` extensions (needed for Node strip-types). The worker imports `../../../lib/shorts/plan.ts`.

**Produces:**
```ts
// styles.ts
export type StyleMeta = { slug; name; tagline; bestFor; secondsMin; secondsMax; is3d; defaultVoice; exampleTitle; position };
export function parseStyle(slug: string, styleMd: string, exampleScript: string | null, position: number): StyleMeta;
export function parseVoices(listOutput: string): Voice[];
// stream.ts
export type Step = { kind: 'step'|'log'|'qa'; content: string };
export function stepsFromStreamLine(line: string): Step[];   // one stream-json line → 0..n events
export function needsAttention(text: string): boolean;       // login / usage-limit wording
// prompts.ts
export function planPrompt(job: { style; topic; options; feedback: string|null; previousPlan: ShortPlan|null }, paths: { skill; project }): string;
export function buildPrompt(job: { style; options }, paths): string;
export function allowedTools(stage: 'plan'|'build', paths): string[];
export const SYSTEM_APPEND: string;
// script.ts
export function applyPlanToScript(scriptJson: string, plan: ShortPlan, options: ShortOptions): string;
// outputs.ts
export function readDelivery(text: string): Delivery-without-files | null;
export function checkProbe(ffprobeJson: string): { ok: true; seconds: number } | { ok: false; reason: string };
```
**`parseStyle`:**
- name: the H1 text before `:`;
- tagline: the H1 text after `: ` with the trailing `, 9:16…` removed;
- seconds: the first `(\d{2})-(\d{2}) s` on the line containing `1080x1920`, falling back to 30–45;
- is3d: the name contains `3D`;
- exampleTitle: the first `**…**` after `example/`` = `;
- defaultVoice: the `voice` field in `example/script.json`, or `am_michael`;
- bestFor: from `BEST_FOR[slug]`, falling back to the tagline. The known values are:
  - deep-dive: "What happens if… body and science"
  - night-file: "Mysteries and true crime"
  - inside-out: "Quick 2D science explainers"
  - stick-story: "Survival steps and life hacks"
  - paper-atlas: "History and how it happened"
  - tall-tale: "Funny true stories"
  - cozy-tales: "Bedtime stories for kids"

**`stepsFromStreamLine`:**
- **Assistant `tool_use` with name `Bash`:** map `input.command` by regex. The order and labels are in the spec. A `capture.mjs frames` command → "Looking at key frames". Other Bash commands → nothing.
- **Assistant `text` block:** a `log` event, collapsed and cut to 2000 characters.
- **Text that starts with `QA:`:** a `qa` event.
- **`result` messages:** nothing, because the runner reads them.
- **Bad JSON:** `[]`.

**`applyPlanToScript`:** sets `title` and `lines[i] = { text, caps }`. It keeps any per-line `gap` when the line count is unchanged and drops it otherwise. It sets `voice` and `music`. In `captions` mode it sets `"mode": "captions"`, which the build prompt reads.

**`checkProbe`:** the stream must be 1080x1920 and the duration 20–70 s.

- [ ] Write the tests first, using real STYLE.md headers as fixtures (copy the first 25 lines of inside-out and deep-dive into a `fixtures/` folder) and recorded stream-json lines. Then FAIL → implement → PASS. Commit "Add the Shorts worker's parsers and prompts".

### Task 6: Worker, runtime

**Files:** `config.ts`, `db.ts`, `claude.ts`, `run.ts`, `main.ts`, `fake-claude.mjs`, `run.test.ts`, `README.md`, `orbis-shorts.service`.

**Produces:**
```ts
// config.ts
export type Config = { url; key; owner; skillDir; projectsDir; claudeBin; softwareGl: boolean; pollMs: number };
export function loadConfig(env: NodeJS.ProcessEnv, readFile: (path: string) => string | null): Config; // reads ~/.config/orbis-shorts/.env, throws a plain message on missing values
// db.ts (thin supabase-js wrapper; interface so run.ts can be tested with a fake)
export interface WorkerDb {
  nextJob(owner: string): Promise<JobRow | null>;          // oldest queued for owner
  claim(id: string, stage: 'plan'|'build'): Promise<boolean>; // queued → planning|building, guarded
  event(job: JobRow, kind, content): Promise<void>;          // seq = last + 1, sets last_event_at
  finishPlan(id, plan): Promise<boolean>;                    // planning → plan_ready
  finishBuild(id, delivery): Promise<boolean>;               // building → done
  fail(id, message): Promise<void>;                          // planning|building → failed
  stillRunning(id): Promise<boolean>;                        // not cancelled/deleted
  upload(path, bytes, contentType): Promise<void>;           // 3 tries with backoff
  heartbeat(state, note, voices?): Promise<void>;
  syncStyles(styles, sheets: Map<slug, Buffer>): Promise<void>;
  sweep(owner): Promise<number>;
}
// claude.ts
export function runClaude(opts: { bin; cwd; prompt; system; tools: string[]; timeoutMs; env; onLine(line: string): void; signal: AbortSignal }): Promise<{ code: number|null; timedOut: boolean; tail: string }>;
// run.ts
export async function runJob(job: JobRow, deps: { db: WorkerDb; cfg: Config; claude: typeof runClaude; fs; probe(path): Promise<string> }): Promise<'done'|'plan_ready'|'failed'|'cancelled'|'attention'>;
```
**`runJob`:**
1. Works out the project folder: `projectsDir/<style>-<id first 8>`.
2. **Plan stage:**
   - On attempt 1 with no folder, the prompt tells Claude to run `new_video.sh <style> <name> --dir projectsDir`.
   - Run Claude. Read `plan.json` and validate it; on failure, one repair run with the errors.
   - `finishPlan`.
3. **Build stage:**
   - `applyPlanToScript` writes `script.json`.
   - Run Claude, then read `delivery.json`.
   - Find `renders/*.mp4`, excluding `share.mp4`, and run `ffprobe -v quiet -print_format json -show_streams -show_format`, then `checkProbe`.
   - Upload `short.mp4`, `share.mp4` when it exists, `cover.jpg` (from the `delivery.cover` path or `renders/cover.jpg`) and `review/all.jpg`.
   - `finishBuild`.
4. **Throughout:**
   - Every stream line goes through `stepsFromStreamLine` to `db.event`.
   - Every 20 s, `stillRunning` is checked; when it's false, the run is aborted and the result is `cancelled`.
   - When `needsAttention(tail)`, the result is `attention`.

**`main.ts`:**
- On start: load the config, run `setup.sh`, and check the output contains `All set`. Otherwise send a heartbeat with state `setup` and the output tail, then retry every 10 min.
- Sync the styles and send the voices.
- Loop: sweep every 5 min; on each poll, `nextJob` → `claim` → `runJob`; heartbeat every 30 s; after `attention`, pause for 30 min.
- Stop cleanly on SIGTERM.

**`fake-claude.mjs`:** reads its prompt and writes `plan.json` or (for build) `delivery.json`, `renders/short.mp4` (it copies `FAKE_MP4` when set) and `review/all.jpg`, printing recorded stream lines.

**`run.test.ts`:** an in-memory `WorkerDb`, the fake claude through `runClaude` with `bin: process.execPath` and args, and a stubbed probe.
- Plan → `plan_ready`, with step events in seq order.
- Build → `done`, with 3 uploads.
- An invalid plan, after its repair run, → `failed`.
- `stillRunning` false → `cancelled`.

- [ ] Tests first → FAIL → implement → PASS. Write the README with:
  - the env file, plus `chmod 600`;
  - `CLAUDE_BIN` (for example the Cursor extension's `native-binary/claude`);
  - `systemctl --user enable --now orbis-shorts`;
  - `journalctl --user -u orbis-shorts -f`.

  Commit "Add the Shorts worker".

### Task 7: UI

**Files:** `components/shorts/{shorts-view,worker-strip,style-board,intake,job-card,plan-editor,library}.tsx`, `app/styles/page-shorts.css`, `app/(orbis)/layout.tsx` (import the CSS after `page-social.css`), `components/social/social-screen.tsx`.

- **The switch:**
  - In `SocialScreen`, `const [area, setArea] = useState<'planner'|'shorts'>(() => hash starts with '#social/shorts' ? 'shorts' : 'planner')`.
  - An `so-mini` radiogroup **Planner | Shorts** sits under `FieldHead`. Choosing Shorts sets the hash `#social/shorts`; choosing Planner sets the month hash.
  - When `area === 'shorts'`, render `<ShortsView />` instead of the planner sections (the lead, calendar, pipeline, insights).
- **`ShortsView`:**
  - Loads `loadShortsViewAction` on mount and keeps `jobs` in state.
  - Polls every 3 s while `jobs.some(isActive)`: it reloads the view, which is cheap, and the open job card fetches its events.
  - Internal screens: `board`, `style:<slug>` (detail plus intake), `job:<id>` (timeline, plan editor or finished view).
- **Sections:**
  - **`WorkerStrip`:** maps presence to text and a dot; `none` and `setup` show the setup steps.
  - **`StyleBoard`:** cards with an `<img>` from `sheetUrl`, lazy-loaded.
  - **`Intake`:** a form with the fields in the spec; submit calls `queueShortAction`.
  - **`JobCard`:**
    - status chip, timeline (`step` events as a checklist where the last one is current, plus the last `log` line), Cancel and Retry;
    - when the status is `plan_ready`, it renders `PlanEditor`;
    - when `done`, it renders `ShortResult` (from `library.tsx`: player, downloads, copy buttons, QA list, contact sheet, delete).
  - **`PlanEditor`:**
    - per line: text (textarea), caps (input) and shot (input);
    - a live `validatePlan` shows errors per line; Build is disabled until the plan is valid;
    - Ask for changes (textarea plus send) and Discard (cancel).
  - **Library grid:** `done` jobs as 9:16 tiles using `covers[id]`.
- **Accessibility:** every control has a label, the status uses `aria-live="polite"`, and buttons are at least 40 px tall.

- [ ] Implement, then `pnpm typecheck && pnpm lint` → clean. Commit "Add the Shorts area to Social".

### Task 8: Verification

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass. Fix whatever fails.
- [ ] Run the worker's flow test once more, plus a dry worker start against a missing env file, which must print a clear message.
- [ ] Commit any fixes. Report what's left for the owner:
  - apply the migration;
  - write the env file and set up the service;
  - run one Inside Out short end to end.
