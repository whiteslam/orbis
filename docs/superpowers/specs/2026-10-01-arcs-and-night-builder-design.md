# Arcs and the night builder: Orbis reshapes itself around one goal

Date: 2026-10-01 · Status: designed, not scheduled · Scope: product design, system design and architecture. No code yet.

## Why

Orbis today is a set of tabs that each look after one area. It reacts well (heads-ups, the brief, Ask Orbis), but it never commits to a direction. People do: "winter arc", "90 days of discipline", "get my money straight before March". For those stretches they want everything pointed at one goal and nothing else in the way.

The picture is the Infinity Castle in Demon Slayer. Nakime plays one note and the whole castle rearranges itself around a single purpose. Starting an arc is that note. Orbis is the castle.

Two features, designed together because the second feeds the first:

1. **Arcs.** The person describes a goal. Orbis designs a plan for it, shifts the whole app around it, and keeps correcting the plan as it learns what actually happens (self-healing).
2. **The night builder.** Between 02:00 and 05:00 an AI works on the person's behalf: it reviews the arc, builds what is missing, and reports in the morning. It can be paused or stopped at any time from the app.

Success means:

1. Starting an arc takes one conversation of a few minutes, and the app visibly changes when it starts.
2. Every tab shows the arc's version of itself while the arc runs, and returns to normal when it ends.
3. The plan adjusts at least every few days from real data, and every change is explained and can be undone.
4. The night builder never runs outside 02:00–05:00 (the person's time zone), never exceeds its budget, and always stops within one step when told to.
5. Nothing it builds as code reaches the live app without the person's approval.

## Glossary

| Term | Meaning |
|---|---|
| **Arc** | A time-boxed goal with a name, a theme and a plan, e.g. "Winter Arc, 90 days". |
| **Arc plan** | The structured design of an arc: phases, daily non-negotiables, targets, rules for slips. Stored as validated JSON, never free text. |
| **Block** | A capability the app already knows how to render and run: a routine, a tracker, a Today widget, a heads-up rule, a journal prompt, a theme, a program. The AI arranges blocks; it does not invent them at runtime. |
| **Program** | A block made of steps and rules over days, e.g. "7-day sugar detox: day 1 do X; if a day is missed, do Y". Data, not code. |
| **Shift** | What changes in the app while an arc runs: theme, Today layout, tab emphasis, notification voice. |
| **Review** | The self-healing step: measure the arc against the plan, propose adjustments, apply the safe ones. |
| **Night shift** | One run of the night builder, 02:00–05:00. |
| **Level 1 build** | A new or changed block, stored as data. Safe to apply automatically; undoable. |
| **Level 2 build** | New code (a screen, a calculation, a connection) written on a branch, tested and deployed to a preview. Needs approval before it goes live. |

## Journey: a Winter Arc

1. **The note.** The person opens Ask Orbis and says "start a winter arc". Orbis asks a short interview: what winning looks like, how many days, where they are now (weight, sleep, spend, habits), what usually makes them quit, how hard they want it.
2. **The design.** Orbis proposes an Arc plan: 90 days in three phases (foundation, build, peak); non-negotiables such as a 05:30 wake, gym, no sugar, 20 minutes of reading, one journal line; targets for steps, sleep, training and a spending cap; slip rules ("two missed days in a row: lighter day, not a reset"). The person edits anything, then taps **Begin**.
3. **The shift.** The app changes on the spot:
   - a winter theme (cold palette, frost wallpaper, the arc name in the header)
   - Today opens on the arc: *Day 1 of 90*, today's non-negotiables, the streak, the phase
   - Health shows the arc's training plan; Money shows the arc's cap and what is left today; Journal prompts arc reflections; Social steps back
   - notifications and heads-ups speak in the arc's voice and push its priorities
4. **Living it.** The person ticks non-negotiables as they go (the existing routine check-ins).
5. **Self-healing.** Every three days, and after any bad run, Orbis reviews the arc: "You've missed the 05:30 wake 5 of 7 days but never the gym. I'd move wake to 06:15 and the gym to 18:30." Small changes apply automatically; big ones wait for a tap. All of them are logged.
6. **Nights.** At 02:00 the night builder looks at the arc, adds a cold-shower tracker the person keeps mentioning in the journal, and drafts a "sleep debt" screen that needs code. In the morning: *"I added a cold-shower tracker. I also built a sleep-debt screen; it's on a preview, waiting for your OK."*
7. **The end.** Day 90: a recap (what was done, how the plan changed, before and after), a keepsake card, and the app shifts back, or straight into the next arc.

## Decisions so far

| Question | Decision |
|---|---|
| Does the AI write code inside the running app? | **No.** At runtime it arranges blocks (data). Code is only written by the night builder, on a branch, and needs approval. |
| Self-healing changes | Small, bounded changes apply automatically and are undoable; anything that changes the goal, length or difficulty waits for a tap. |
| When the night builder runs | 02:00–05:00 in the person's time zone, hard stop at 05:00. Work not finished is kept as a draft for the next night, never half-applied. |
| Control | Pause/Resume, Stop now, Undo, a nightly budget cap, and a history of every run, all in Settings. |
| Level 1 builds | Automatic. |
| Level 2 builds | Branch → tests → preview → morning report → the person approves → merged and deployed. |
| Out of bounds, always | Login and auth, security and app lock, account deletion and export, payments, AI consent, secrets, migrations that drop or rewrite data. |

### Open questions (answer before planning)

1. **One arc at a time, or several?** Recommendation: one active arc. Focus is the point; a second goal can live inside the arc as a phase.
2. **How far does the shift go?** Option A: theme + Today + tab emphasis. Option B: also reorder or hide tabs and add arc-only screens. Recommendation: A first, B once Level 2 exists.
3. **Level 2 auto-ship?** Recommendation: never automatic. If wanted later, only behind green tests plus automatic rollback on any error spike.
4. **Just the owner, or other users too?** If other people use Orbis, Level 2 code affects everyone, so Level 2 must produce per-user *modules* switched on by a flag, and approval moves from the person to the owner.
5. **Where does the night builder run?** Recommendation: a scheduled cloud agent (Claude Code routine) with repo access, so the laptop can be off. The app only holds the switch and reads the reports.

## System architecture

### Overview

```
                     ┌────────────────────────── Orbis app (Next.js on Vercel) ───────────────────────────┐
                     │                                                                                   │
   person ──────────▶│  Ask Orbis ──▶ Arc designer ──▶ Plan validator ──▶ arcs / arc_blocks (Supabase)   │
                     │                                                        │                          │
                     │  Today · Money · Health · Journal · Social ◀── Shift resolver ◀────────────────┤  │
                     │        (render blocks for the active arc)                                      │  │
                     │                                                                                │  │
                     │  Settings ▸ Arcs & night builder ──▶ builder_controls (pause, stop, budget)     │  │
                     └────────────────────────────────────────────────────────────────────────────────│──┘
                                                                                                      │
   pg_cron ── every 15 min ──▶ /api/arcs/review   (self-healing, bounded, inside the app) ─────────────┤
   pg_cron ── 02:00 local  ──▶ /api/night/start   (opens a night run, checks switch + budget) ─────────┤
                                                                                                      │
                     ┌──────────────── Night builder (cloud agent, outside the app) ──────────────────┐ │
                     │  reads the run brief ─▶ plans ─▶ Level 1: calls /api/night/apply (blocks)       │─┘
                     │                               ─▶ Level 2: branch ─▶ tests ─▶ Vercel preview ─▶ PR │
                     │  checks /api/night/control between every step · hard stop 05:00 · posts report │
                     └────────────────────────────────────────────────────────────────────────────────┘
                                                         │
                                           morning push + Today card: "last night I…"
```

Two loops, deliberately separate:

- **The review loop** runs inside the app, often, cheaply, and can only change blocks within bounds.
- **The night loop** runs outside the app, rarely, with more power, and can write code, but only to a branch.

### Modules

New code follows the heads-ups pattern (`lib/headsups/`): pure logic separate from I/O, deterministic checks decide, the AI only proposes and words.

| Unit | Does | Depends on |
|---|---|---|
| `lib/arcs/types.ts` | `Arc`, `ArcPlan`, `Block`, `BlockKind`, `Adjustment`, the zod-style schemas | nothing |
| `lib/arcs/blocks/registry.ts` | The closed list of block kinds, each with a schema, a renderer id, and what it may touch | types |
| `lib/arcs/design.ts` | Interview answers → draft `ArcPlan` through `lib/ai/router.ts` (sensitivity `personal`); rules-only fallback template when AI is off | router, gate, consent |
| `lib/arcs/validate.ts` | Pure: rejects any plan or adjustment outside the registry or its bounds | types, registry |
| `lib/arcs/metrics.ts` | Pure: routine events, steps, sleep, spend, journal → adherence per block, streaks, phase progress | types |
| `lib/arcs/review.ts` | Pure: metrics + plan → proposed `Adjustment[]`, each marked `auto` or `needs_tap` by fixed rules | metrics, validate |
| `lib/arcs/shift.ts` | Pure: active arc → theme tokens, Today layout, tab emphasis, notification voice | types |
| `lib/arcs/repository.ts` | Supabase reads and writes, owner-scoped | supabase |
| `lib/night/control.ts` | Switch, budget and window checks, used by every night route | supabase, `lib/notifications/schedule.ts` (`localClock`) |
| `lib/night/brief.ts` | Builds the run brief the agent reads: arc state, recent metrics, open drafts, allowed actions. Minimised, no raw journal text | arcs, metrics |
| `lib/night/report.ts` | Turns a finished run into the morning card and push | notifications |
| `components/arcs/*` | Arc interview, plan editor, Today arc header, arc recap, adjustments inbox | — |
| `components/settings/night-builder.tsx` | Pause/Resume, Stop now, budget, history, pending approvals | — |

### Data model

All tables are owner-scoped with RLS, follow the `202609280200_hardening.sql` grant pattern (revoke all, grant exactly what is used), and are added to `EXPORT_TABLES` and the deletion plan in `lib/account/deletion-plan.ts`.

```sql
arcs (
  id uuid pk, user_id uuid fk,
  name text, theme text,                 -- theme is a registry id, e.g. 'winter'
  status text check (status in ('draft','active','paused','completed','abandoned')),
  starts_on date, ends_on date,
  plan jsonb,                            -- validated ArcPlan, versioned below
  plan_version int,
  created_at, updated_at
)
-- at most one active arc per user:
create unique index on arcs (user_id) where status = 'active';

arc_blocks (
  id uuid pk, arc_id uuid fk, user_id uuid fk,
  kind text,                             -- registry kind: routine | tracker | widget | headsup_rule | prompt | program
  config jsonb,                          -- validated against the kind's schema
  source text check (source in ('design','review','night','person')),
  active bool, created_at, updated_at
)

arc_adjustments (                        -- the self-healing log
  id uuid pk, arc_id uuid fk, user_id uuid fk,
  reason jsonb,                          -- the metrics that triggered it
  change jsonb,                          -- before/after, enough to undo
  mode text check (mode in ('auto','needs_tap')),
  status text check (status in ('proposed','applied','declined','undone')),
  created_at, decided_at
)

builder_controls (                       -- one row per user; the kill switch
  user_id uuid pk,
  enabled bool default false,
  stop_requested_at timestamptz,
  nightly_budget_cents int default 200,
  level2_enabled bool default false,
  updated_at
)

night_runs (
  id uuid pk, user_id uuid fk,
  status text check (status in ('queued','running','stopping','stopped','completed','failed','expired')),
  window_start timestamptz, window_end timestamptz,
  spent_cents int, steps jsonb,          -- what it did, in order
  report jsonb,                          -- the morning card
  created_at, finished_at
)

night_builds (                           -- Level 2 work
  id uuid pk, run_id uuid fk, user_id uuid fk,
  title text, branch text, pr_url text, preview_url text,
  checks jsonb,                          -- typecheck, unit, e2e results
  status text check (status in ('draft','awaiting_approval','approved','merged','rejected','abandoned')),
  created_at, decided_at
)
```

The person's client may read all of these and write only `builder_controls` and the decisions on `arc_adjustments` / `night_builds`. Everything else is written by server routes with the service role.

### Blocks: how the AI builds without writing code

The registry is the whole trick. The AI can produce any combination of blocks, and every block kind is code a human wrote and tested.

| Kind | Config (examples) | Renders as | Reuses |
|---|---|---|---|
| `routine` | title, time, days, kind | a routine with check-ins | `lib/routines` |
| `tracker` | label, unit, target, frequency | a quick-log row on Today, a chart | new, small |
| `widget` | which Today widget, order, size | Today layout | `components/today` |
| `headsup_rule` | check kind, thresholds | a heads-up | `lib/headsups/checks` |
| `prompt` | journal question, cadence | a Journal prompt | `components/journal` |
| `program` | ordered steps, day rules, slip rules | a multi-day checklist | new, composed of the above |
| `theme` | registry theme id | tokens and wallpaper | `app/styles/glass.css` tokens |

`validate.ts` enforces per-kind bounds, for example: no more than 8 non-negotiables a day, no routine before 04:30, a spending cap never above the person's own average, no calorie target outside safe limits, and nothing that turns on a push outside 07:00–22:00.

### The shift

`shift.ts` is a pure function from the active arc to a `ShiftState`:

```ts
type ShiftState = {
  theme: ThemeId | null;                 // swaps CSS tokens via [data-arc-theme] on the app shell
  today: TodayLayout;                    // arc header first, then the arc's widgets in plan order
  emphasis: Record<TabId, 'lead' | 'normal' | 'quiet'>;
  voice: { name: string; tone: 'calm' | 'firm' | 'hype' };  // passed to the brief and notification writers
};
```

The app shell reads it once per render. Themes are CSS token sets added next to `glass.css`, so a theme can never change layout or behaviour, only look. With no active arc, `ShiftState` is the normal app.

### The self-healing loop

```
routine events, steps, sleep, spend, journal (numbers only)
        │
        ▼
metrics.ts  ──▶ adherence per block, streaks, trend, phase progress        (pure, deterministic)
        │
        ▼
review.ts   ──▶ candidate adjustments from fixed rules                      (pure, deterministic)
        │           e.g. adherence < 40% over 7 days → propose easier time or lower target
        ▼
design.ts   ──▶ AI may refine wording or pick between candidates            (router, 'personal')
        │           it cannot invent an adjustment the rules did not propose
        ▼
validate.ts ──▶ drop anything outside bounds
        │
        ├── mode = auto      → apply, log in arc_adjustments, show in "what changed"
        └── mode = needs_tap → proposed card on Today
```

Rules decide *that* something should change; the AI only helps say *how* and words it. This is the same split heads-ups uses (deterministic checks detect, AI words), for the same reasons: testable, cannot invent problems, sends less personal data.

`auto` vs `needs_tap` is fixed in code per adjustment type: moving a time by ≤ 60 minutes or a target by ≤ 20% is `auto`; changing the goal, the length, the difficulty, or adding or removing a non-negotiable is `needs_tap`.

### The night builder

#### Run lifecycle

```
            02:00 local, enabled, budget left, no run today
 (none) ───────────────────────────────────────────────▶ queued
 queued ──── agent picks up the brief ─────────────────▶ running
 running ─── Stop now / pause / budget hit ────────────▶ stopping ──▶ stopped
 running ─── all steps done ───────────────────────────▶ completed
 running ─── 05:00 reached ────────────────────────────▶ expired   (unfinished work kept as draft)
 running ─── unrecoverable error ──────────────────────▶ failed
```

Every agent step starts with `GET /api/night/control?run=…`. If the answer is anything but `continue`, the agent stops before doing more. That call is what makes Stop now take effect within one step.

#### What a night does

1. **Brief.** `/api/night/start` checks the window, the switch and the budget, creates the `night_runs` row and returns the brief: arc plan, last 7 days of metrics, open adjustments, open drafts, the allowed actions and the remaining budget. No raw journal text, only derived signals (for example "mentions cold showers 4×").
2. **Plan.** The agent picks at most three improvements, Level 1 first.
3. **Level 1.** For each, `POST /api/night/apply` with a block or block change. The route runs `validate.ts`, writes `arc_blocks` with `source = 'night'`, logs the step. Rejected changes are logged with the reason.
4. **Level 2** (only if `level2_enabled`). The agent:
   - creates `night/<date>-<slug>` from `main`
   - writes the change inside an allow-list of paths (`components/`, `lib/arcs/`, `lib/night/`, `app/(arcs)/`) and never inside the deny-list (`lib/auth`, `lib/security`, `lib/account`, `lib/crypto`, `lib/ai/consent*`, `app/auth`, `supabase/migrations`, `.env*`, `proxy.ts`)
   - runs `pnpm typecheck`, `pnpm test`, `pnpm lint`, then the relevant Playwright specs against the preview
   - pushes the branch; Vercel builds a preview; the agent opens a draft PR with the checks and a screenshot
   - records a `night_builds` row as `awaiting_approval`
   - if any check fails twice, it abandons the branch and says so in the report
5. **Report.** `/api/night/finish` stores the report and sends one push at the person's normal morning slot, never at night.

#### Approval

The Settings sheet lists `awaiting_approval` builds with the preview link. **Approve** marks the PR ready and merges it through the GitHub API (server-side token, never in the browser); the normal Vercel deploy follows. **Reject** closes the PR and deletes the branch. Nothing merges automatically.

#### Where each part runs

| Part | Runs in | Why |
|---|---|---|
| Window trigger | Supabase `pg_cron`, like `notifications_schedule.sql` and `headsups_schedule.sql` | already how Orbis schedules work |
| Control, apply, finish routes | the Orbis app, `CRON_SECRET`-style bearer plus a per-run token | the app owns the data and the switch |
| The builder agent | a scheduled cloud agent with repo access | can be long-running, can run git and tests, laptop can be off |
| Previews | Vercel preview deployments | already set up for the repo |

## Safety, privacy and cost

- **Consent.** Arcs' AI features and the night builder are off until AI is on (`lib/ai/consent.ts`) and the night builder has its own switch, off by default.
- **Sensitivity routing.** Arc design, review wording and the night brief all go through `lib/ai/router.ts` as `personal`, so they only reach providers allowed to hold personal data.
- **Minimised data.** The night brief carries numbers and derived signals, never journal text, email, documents or health files.
- **Bounds in code.** Validators, not prompts, decide what may change. A prompt that talks the model into something outside bounds still produces a rejected change.
- **No privilege for the agent.** It gets a per-run token scoped to the night routes for one user and one run, expiring at 05:00. It never sees the Supabase service key or user sessions. Repo access is a separate, repo-scoped token held by the cloud agent, not by the app.
- **Budget.** `nightly_budget_cents` is checked before every paid step; the run stops at the cap. A monthly cap sits above it. Spend is recorded per run.
- **Rate limits.** Arc design, review and night routes join `lib/security/rate-limit-rules.ts`.
- **Undo.** Every Level 1 change and every adjustment stores enough to reverse it. Undo is one tap and is itself logged.
- **Health.** Plans never set medical targets. Training and diet blocks keep the existing "not medical advice" line, and validators reject extreme targets.
- **Account deletion and export** include every new table from day one.

## Failure handling

| Failure | What happens |
|---|---|
| AI off or provider down during design | Rules-only arc templates (winter, discipline, money reset) the person fills in |
| Review finds nothing | Nothing changes; no card |
| Night agent crashes | Run is marked `failed` at 05:00 by the expiry sweep; no half-applied changes because each apply is one transaction |
| Tests fail on a Level 2 build | Branch abandoned, reason in the report |
| Stop pressed mid-step | Current step finishes or rolls back; no further steps start |
| Budget hit | Run moves to `stopping`, report says what was left undone |
| Preview works but person rejects | PR closed, branch deleted, idea recorded so it is not rebuilt next night |

## Observability

- `night_runs.steps` is the audit trail: each step, its cost, its result.
- `arc_adjustments` is the self-healing history, shown to the person as "how your arc changed".
- Server errors go to `console.error` like the rest of the app (Sentry arrives in Phase 2 of the productization roadmap).

## API surface

| Route / action | Caller | Auth |
|---|---|---|
| `startArcInterview`, `saveArcPlan`, `beginArc`, `pauseArc`, `endArc` (server actions) | person | session + app unlocked |
| `decideAdjustment`, `undoAdjustment` | person | session + app unlocked |
| `setBuilderControls`, `stopNightRun`, `decideNightBuild` | person | session + app unlocked + fresh auth for enabling Level 2 |
| `POST /api/arcs/review` | pg_cron | `CRON_SECRET` |
| `POST /api/night/start` | pg_cron → agent | `CRON_SECRET`, returns per-run token |
| `GET /api/night/control` | agent | per-run token |
| `POST /api/night/apply` | agent | per-run token |
| `POST /api/night/finish` | agent | per-run token |

## Delivery plan

Each stage ships on its own and is useful without the next.

| Stage | What ships | Depends on |
|---|---|---|
| 1. Arc core | Tables, block registry (routine, widget, prompt, theme), rules-only templates, begin/pause/end, the Today arc header | — |
| 2. The shift | `ShiftState`, winter theme and two more, tab emphasis, arc voice in the brief and notifications | 1 |
| 3. AI design | Interview in Ask Orbis, AI-drafted plans, plan editor | 1, AI consent |
| 4. Self-healing | Metrics, review rules, adjustments inbox, auto/tap, undo, the arc recap | 1 |
| 5. Night builder, Level 1 | Controls in Settings, run lifecycle, window cron, control/apply/finish routes, cloud agent, morning report | 4 |
| 6. Trackers and programs | `tracker` and `program` blocks, so nights can build more | 5 |
| 7. Night builder, Level 2 | Branch/test/preview/PR pipeline, approval flow, allow/deny paths | 5, open question 4 answered |

Each stage gets its own implementation plan in `docs/superpowers/plans/` before code, the same way heads-ups was done.

## Risks

- **Overreach.** An app that keeps changing itself can feel unstable. Mitigation: changes batch into the review cadence and the morning report, never mid-session, and every change is visible and undoable.
- **Cost creep.** Nightly AI plus previews every night adds up. Mitigation: per-night and monthly caps, and a night with nothing worth doing ends early.
- **Code quality from Level 2.** Tests catch breakage, not bad design. Mitigation: approval stays manual, allow-listed paths only, small changes only (one feature per build).
- **Privacy.** A builder that reads everything is a bigger target. Mitigation: minimised brief, per-run token, no service key in the agent.
- **Multi-user.** Level 2 is only straightforward while Orbis is a single-owner app. Open question 4 must be settled before stage 7.

## Owner setup (when stage 5 and 7 are built)

- Run the arcs and night migrations, then `supabase/cron/night_schedule.sql` after deploy.
- Create the scheduled cloud agent and give it a repo-scoped GitHub token.
- Add a GitHub token for merges (approval flow) to Vercel server env only.
- Set the monthly night-builder budget.
