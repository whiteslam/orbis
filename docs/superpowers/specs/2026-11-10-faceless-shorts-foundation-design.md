# Faceless Shorts in Social: Foundation

Date: 2026-11-10 · Status: **approved by the owner 2026-11-10** · Scope: sub-project 1 of 4.

## Why

The owner makes narrated faceless shorts with the `faceless-shorts` Claude Code skill (`~/.claude/skills/faceless-shorts/`, seven styles). Today that only works from a terminal. This adds a **Shorts** area to the Social tab where the owner picks a style, describes a short, approves its plan and gets the finished MP4. The skill keeps doing the actual making.

## Sub-projects

1. **Foundation (this spec):** PC worker, job queue, style board, intake, plan edit/approve, build with live progress, library with a delivery kit.
2. Ideas generator, one revision round, own-recording mode, voice samples, Send to Social calendar (Reel post with the MP4).
3. YouTube upload (Google OAuth, `youtube.upload`) and publishing presets.
4. Style studio: add or tweak a style from the app (the skill's "Adding a new style" flow).

## Decisions

- **Rendering runs on the owner's PC.** Vercel functions stop at 60 s and can't run Chrome, ffmpeg, Kokoro or Whisper.
- **Claude Code writes each short.** The worker runs `claude -p` with the skill, so quality matches a terminal session. It uses the owner's Claude Code login.
- **Two stages with a plan gate.** Plan → owner edits and approves → build. A bad script never costs a render.

## Architecture

```
Orbis (Vercel)                     Supabase                              Owner's PC: workers/shorts-studio (Node 22)
Social → Shorts                    shorts_jobs                           polls every 5 s
 intake ─► queueShort ───────────►  queued→planning→plan_ready→      ◄── claim (status-guarded update)
 plan editor ─► approvePlan ─────►  queued(build)→building→done      
 live view polls events ◄─────────  shorts_events (seq log)          ◄── one event per skill step
 style board ◄────────────────────  shorts_styles (catalog)          ◄── synced from the installed skill on start
 worker strip ◄───────────────────  shorts_worker (heartbeat)        ◄── every 30 s
 library ◄── signed URLs ─────────  storage bucket `shorts` (private)◄── plan.json, all.jpg, cover.jpg, short.mp4
```

### Data

- **`shorts_jobs`**
  - **Identity and inputs:** `id`, `user_id`, `style`, `topic` (≤300), `options` jsonb.
    - `options` holds `seconds` (25–60), `voice`, `mode` (`voice` | `captions`), `music` (`bed` | `none`) and `endLine` (≤80).
  - **State:** `status` (`queued` | `planning` | `plan_ready` | `building` | `done` | `failed` | `cancelled`) and `stage` (`plan` | `build`).
  - **Plan:** `plan` jsonb and `plan_feedback` (≤1000).
  - **Delivery:** `delivery` jsonb, holding title, caption, hashtags, QA notes, duration and file paths.
  - **Bookkeeping:** `error` (≤500), `attempt`, `started_at`, `finished_at`, `last_event_at`, `created_at`, `updated_at`.
  - **RLS:** the owner reads their own rows; only the service role writes.
- **`shorts_events`**
  - Columns: `job_id`, `user_id`, `seq`, `kind` (`status` | `step` | `log` | `qa`), `content` (≤4000), `at`.
  - The live view asks for `seq > n`.
- **`shorts_styles`**
  - Columns: `slug` (pk), `name`, `tagline`, `best_for`, `seconds_min`, `seconds_max`, `is_3d`, `default_voice`, `sheet_path`, `example_title`, `position`, `synced_at`.
  - Readable by any signed-in user; written by the service role.
- **`shorts_worker`**
  - Columns: `user_id` (pk), `last_seen`, `state` (`idle` | `busy` | `paused` | `setup`), `note`, `voices` text[], `version`.
- **Storage bucket `shorts`:** private, MP4/JPEG/PNG/JSON, 200 MB per file. The path starts with the user ID: `<user>/<job>/…` and `styles/<slug>.png`.

### Flow

1. **Intake:** `queueShort` inserts a job with status `queued` and stage `plan`.
2. **Plan:** the worker claims it (status `planning`) and runs the plan prompt. It validates `plan.json`, then sets `plan_ready` with `plan`.
3. **Owner choices:** on `plan_ready` the owner can
   - **approve:** `approvePlan` stores the edited plan and sets status `queued` with stage `build`;
   - **ask for changes:** `requestPlanChanges` sets status `queued` with stage `plan` and stores `plan_feedback`;
   - **discard:** sets `cancelled`.
4. **Build:** the worker claims the job (status `building`). It writes the approved lines into `script.json` with no AI involved, then runs the build prompt. It checks the outputs, uploads them, then sets `done` with `delivery`.
5. **Retry:** a failed job can be retried. It goes back to `queued` at the same stage, and `attempt` goes up by 1.

## Worker (`workers/shorts-studio/`)

**Setup**
- Node 22 and TypeScript, run with `node --experimental-strip-types`.
- Runs as a systemd user service.
- Config lives in `~/.config/orbis-shorts/.env` (mode 600):
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_USER_ID`;
  - `SKILL_DIR` (default `~/.claude/skills/faceless-shorts`);
  - `PROJECTS_DIR` (default `~/faceless-shorts`);
  - `CLAUDE_BIN` (default `claude`);
  - `SOFTWARE_GL`.

**On start**
- Upserts `shorts_styles` from each `styles/<slug>/STYLE.md` and uploads `style-sheet.png`.
- Stores the voice list (`scripts/py scripts/voice.py --list`) on `shorts_worker`.

**Claiming and recovery**
- Claims only jobs whose `user_id` is `OWNER_USER_ID`, one at a time.
- Sends a heartbeat every 30 s.
- Sweep: a `planning` or `building` job with no event for 60 min becomes `failed`.

**Claude runs**
- Each stage is one `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools …` run, in `PROJECTS_DIR/<slug>-<job8>/`.
- The topic and options are passed inside a fenced block labelled as user data.
- **Plan prompt:** do the skill's intake from the given answers without asking questions, run `new_video.sh`, write `script.json` and `plan.json` (schema below), and stop before the voice step.
- **Build prompt:** the skill's steps 3–5 on the existing project. This covers voice, words, shots, check, cues, mix and QA on the contact sheet, then video, cover and `delivery.json`, plus `share.mp4` when the MP4 is over 35 MB.
- **Allowed tools:**
  - Read, Write, Edit, Glob and Grep;
  - Bash for `node tools/capture.mjs`, the skill's `scripts/`, `ffmpeg`, `ffprobe`, `ls`, `mkdir` and `cp`;
  - WebSearch and WebFetch in the plan stage only.
- **Timeouts:** 15 min for the plan, 120 min for the build.
- **Progress:** each Bash command in the stream is mapped to a step event:
  - `new_video.sh` → "Setting up the project"
  - `voice.py` → "Recording the voice"
  - `words.py` → "Timing every word"
  - `capture.mjs check` → "Checking the shots"
  - `capture.mjs cues` → "Placing sound cues"
  - `mix.py` → "Mixing sound and music"
  - `capture.mjs sheet` → "QA: checking every frame"
  - `capture.mjs video` → "Rendering the video"

  Assistant text becomes `log` events, capped at 2000 characters.
- **Checks:**
  - `plan.json` must pass the schema. If it doesn't, Claude gets one repair prompt.
  - The MP4 must pass `ffprobe`: 1080x1920 and 20–70 s.
  - `delivery.json` must parse.

**Failures**
- Uploads get 3 retries with backoff.
- A Claude login or usage-limit message in the output fails the job with "Claude Code needs attention on your PC" and pauses claims for 30 min.

**Files**
- Project folders are kept on the PC for revisions.

### `plan.json`

```json
{ "title": "What If You Swallow Gum?", "seconds": 30,
  "lines": [{ "text": "What happens if you swallow your gum?", "caps": "WHAT *HAPPENS | IF YOU *SWALLOW | YOUR *GUM?", "shot": "Hero holds gum, x-ray zoom" }],
  "sources": ["Mayo Clinic, ..."], "notes": "optional" }
```

**Rules**, shared by the app and the worker in `lib/shorts/plan.ts`:
- **Lines:** 3–30 lines, each with text of 1–300 characters.
- **Caption chunks:** chunks are split on `|`; each has 1–3 words and exactly one word starting with `*`.
- **Other fields:** title of 1–120 characters, shot of ≤300, at most 12 sources.

## UI (`components/shorts/`)

- **Switch:** the Social header gets **Planner | Shorts**, and the hash is `#social/shorts`. The only change to `social-screen.tsx` is the switch.
- **Worker strip:** online/idle, busy, offline (last seen) or needs setup, with a how-to-start note.
- **Style board:**
  - Cards show the sheet image, name, tagline, best-for, length range and a 2D/3D badge.
  - The detail view shows the full sheet, the example title and **Use this style**.
- **Intake:** topic, length (within the style's range), voice (from the synced list), mode (AI voice / captions only), music (bed / none), end line. Then **Generate plan**.
- **Jobs:** a live timeline (polled every 3 s while active) and Cancel.
- **Plan editor:**
  - Editable title, plus per-line text, caps and shot.
  - Add and remove lines; sources are read-only.
  - Live checks against the plan rules.
  - Buttons: **Build video**, **Ask for changes**, **Discard**.
- **Library:**
  - 9:16 tiles; each opens a player with signed URLs.
  - Downloads: the MP4, plus the share copy when there is one.
  - The cover, and title, caption and hashtags with copy buttons.
  - "What QA caught", the contact sheet, and Delete.
- **Server actions (`app/shorts/actions.ts`):** `loadShortsView`, `loadJobEvents`, `queueShort`, `approvePlan`, `requestPlanChanges`, `cancelJob`, `retryJob`, `deleteShort`.
- **Limits:** at most 3 jobs in flight and 30 jobs created per month per user.

## Security

- **Worker:** claims only `OWNER_USER_ID` rows. The service-role key stays on the PC.
- **Input:** topic text is limited in length, stripped of control characters, and passed as fenced data.
- **Claude:** runs under a tool allowlist, with web access only for planning.
- **Storage:** the bucket is private, and files are served through 1-hour signed URLs.
- **Account data:** account deletion removes `shorts_*` rows (cascade) and the user's storage prefix. Account export includes jobs.

## Testing

- **App (vitest):**
  - the plan validator;
  - the status changes for each action;
  - queue limits;
  - event merging.
- **Worker (vitest):**
  - stream-json → events, on fixtures;
  - claim guard and sweep;
  - writing the plan into `script.json`;
  - STYLE.md parsing;
  - output checks.

  A fake `claude` script replays a recorded stream for a flow test.
- **Manual:** one Inside Out short end to end on the PC.

## Out of scope

Ideas, revisions, own recording, voice samples, Send to calendar, YouTube, presets and the style studio. These are sub-projects 2–4.
