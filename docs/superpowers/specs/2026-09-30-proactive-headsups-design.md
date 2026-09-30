# Proactive heads-ups: Orbis notices things before you ask

Date: 2026-09-30 · Status: draft for review · Scope: Phase 1 (engine, Money, Routines & health)

## Why

Every AI feature in Orbis today waits to be asked: Ask Orbis answers a question, the health planner answers a form, the portfolio read runs when you press the button. The brief is proactive, but it is rules-written and only restates today.

Always-on assistants (OpenAI's dots, September 2026) show the shape people now expect: something that watches what matters to you and brings you work, "sometimes before you even think to ask". Orbis can do the useful half of that without giving up what makes it Orbis: read-only connections, no personal data to a provider that trains, and nothing reaching an AI until the person turns AI on.

Success means:

1. Orbis surfaces things worth acting on in Money and Routines & health without being asked, as cards on Today.
2. Each heads-up comes with the next step prepared, one tap away; nothing is saved or sent until the person does it.
3. Only urgent heads-ups push, at most two a day, never at night.
4. Every heads-up is grounded in numbers a deterministic check computed. The AI words them; it never decides that something is wrong.
5. With AI off, heads-ups still work, in Orbis's own wording.

## Decisions made in brainstorming

| Question | Decision |
|---|---|
| Direction | Proactive, dots-style |
| Areas | Money, Routines & health, Mail, Investments, **phased**: Phase 1 = Money + Routines & health (data already in the database); Phase 2 = Mail + Investments (separate spec) |
| Autonomy | Notice + prepare. No autonomous writes; connections stay read-only |
| Delivery | Cards on Today; push only for urgent, capped at 2/day |
| Approach | Deterministic checks detect, AI only words (approach A). A "let the model scan everything" approach was rejected: more personal data sent, untestable, can invent alerts |

## Architecture

New module `lib/headsups/`, four units with one job each:

| Unit | Does | Depends on |
|---|---|---|
| `checks/money.ts`, `checks/routines.ts`, `checks/health.ts` | Pure functions: data in, `Finding[]` out. No I/O | Types only |
| `scan.ts` | Loads one person's data once, runs every enabled check, upserts findings, prunes old rows | Supabase admin client, checks |
| `word.ts` | Turns a finding's evidence into title, body and action label: through the router if AI is allowed, otherwise the check's fallback template | `lib/ai/router.ts`, `lib/ai/gate.ts` |
| `push-rules.ts` | Pure: given today's pushes, the person's clock and a finding, may it push now? | `lib/notifications/schedule.ts` (`localClock`) |

Plus:

- `app/api/headsups/scan/route.ts`: POST, same `CRON_SECRET` bearer check as `/api/notifications/dispatch`, `maxDuration = 60`, 50 s time budget.
- `components/today/headsups.tsx`: the Today card.
- Server actions in `app/headsups/actions.ts`: `snoozeHeadsup`, `dismissHeadsup`, `completeHeadsup`, `setCheckEnabled`, `clearHeadsups`. Each derives the user from `getClaims()` plus `isAppUnlocked`, like every other entry point, and returns `{ success, message }`.
- A Heads-ups group in Settings → AI & privacy.

### The finding type

```ts
type Finding = {
  kind: HeadsupKind;           // e.g. 'money.category_hot'
  dedupeKey: string;           // same problem, same key, e.g. 'money.category_hot:Food:2026-09'
  urgency: 'normal' | 'urgent';
  evidence: Record<string, string | number>; // only the numbers the check used
  action: HeadsupAction;       // one of a closed set, see below
  fallback: { title: string; body: string; actionLabel: string }; // Orbis's own wording
};
```

`urgency` is fixed per kind in code. The AI cannot raise it.

## Checks (Phase 1)

All thresholds are constants beside the check, so they can be tuned in one place. Every check returns nothing when there is too little history. For example, a 28-day average needs at least 14 days of data.

| Kind | Fires when | Urgency | Action |
|---|---|---|---|
| `money.big_spend` | A single expense ≥ 3× the median expense in its category over the last 90 days (category needs ≥ 5 prior expenses) | urgent | `review_category` |
| `money.category_hot` | By day ≥ 10 of the month, a category's month-to-date spend is ≥ 1.3× its average month-to-date spend at the same day over the previous 3 months | normal | `review_category` |
| `money.logging_gap` | No manual expense for ≥ 4 days, when the person logged on ≥ 60% of days in the previous 30 | normal | `open_spending_entry` |
| `routine.slipping` | An active routine has no `done` event on any of its last 3 scheduled days (days in its `days` array, before today, on or after its `created_at`) | urgent | `adjust_routine` |
| `health.steps_down` | 7-day average steps ≤ 0.7× the average of the 28 days before those 7 | normal | `open_steps` |
| `health.plan_finished` | The person's newest health plan ended (created + `durationWeeks`) ≥ 3 days ago | normal | `open_health_plan` |

Money checks read `transactions` where `direction = 'expense'`, in the person's most-used currency over the window (the rest are ignored, as the Spending charts do). Spending is manual-only in the UI today, and the checks do not filter on `source`.

## Actions (closed set)

| Action | Payload | Opens |
|---|---|---|
| `open_spending_entry` | `{ category?: string }` | Money → Spending with the add form open and prefilled |
| `review_category` | `{ category: string }` | Money → Spending, with that category's row in "Where it went" highlighted and scrolled into view |
| `adjust_routine` | `{ routineId: string }` | Settings → Your day, scrolled to that routine |
| `open_health_plan` | `{ planId: string }` | Health → Plans, that plan open (where "build a new one" is one tap away) |
| `open_steps` | `{}` | Health, steps view |

An action only navigates. The person still presses Save. Following an action marks the heads-up `done`. Each action needs a deep-link target; where a screen does not yet accept one (the prefilled spending form, the highlighted category, opening a routine for editing), Phase 1 adds it.

## Data

Migration `202609300100_headsups.sql` (idempotent, like every other migration):

```sql
create table if not exists public.headsups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  urgency text not null check (urgency in ('normal', 'urgent')),
  evidence jsonb not null default '{}'::jsonb,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 300),
  action jsonb not null,
  action_label text not null check (char_length(action_label) between 1 and 40),
  worded_by text not null check (worded_by in ('ai', 'rules')),
  status text not null default 'new' check (status in ('new', 'seen', 'done', 'dismissed')),
  snoozed_until timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
```

Also in the migration:

- **Row-level security.** Owner can select, and can update only `status` and `snoozed_until`. Inserts and deletes go through the admin client, and table grants are narrowed to match, following `202609280200_hardening.sql`.
- **`headsup_preferences`** `(user_id primary key, disabled_kinds text[] not null default '{}', last_scan_date date)`, with owner select and update. `last_scan_date` makes the daily scan run once per person per day.
- **`notification_log`.** Add `'headsup'` to the `slot` check, and exclude it from `notification_log_one_per_slot_day` the way `'test'` is (`where slot not in ('test', 'headsup')`). A heads-up push is made once-only by `headsups.pushed_at`, not by that index.
- The account export includes `headsups` and `headsup_preferences`. Account deletion is covered by `on delete cascade`.

**Dedupe and repeats.** Findings are upserted on `(user_id, dedupe_key)`:

- A `new` or `seen` row keeps its status and gets fresh evidence.
- A `dismissed` row is left alone for 30 days after `updated_at`, then may come back as `new`.
- A `done` row is left alone.

Dedupe keys include the period they are about (the month, the week, or the routine plus the date of its last scheduled day), so a problem that recurs later is a new heads-up.

**Retention.** Each scan deletes that person's rows older than 60 days.

## Flow

1. **Scheduler.** pg_cron calls `/api/headsups/scan` every 15 minutes, next to the dispatch job. The setup SQL goes in `docs/phase-1-owner-actions.md` alongside the existing job.
2. **Who is due.** Each person whose local time is at or after 06:00 and whose `last_scan_date` is before today. Timezone comes from `notification_preferences.timezone`, defaulting to `Asia/Kolkata` as `dueSlots` does. People are claimed by conditionally updating `last_scan_date`, so two overlapping runs cannot scan the same person.
3. **Scan one person.** Load 125 days of expenses (the three months before this one, plus the 90-day median window), active routines and 14 days of routine events, 35 days of steps, and the newest health plan. Run the checks, skipping any kind in `disabled_kinds`. A check that throws is logged with `console.error` and skipped; the rest still run.
4. **Word new findings.** Only findings that are new or have come back get worded; the rest keep their wording. `word.ts` calls `routeJson` with `sensitivity: 'personal'`, `feature: 'headsups'`, low temperature and a 10 s timeout. The prompt contains the kind, the evidence object and the fallback wording, nothing else. The output is validated to `{ title ≤ 80, body ≤ 300, actionLabel ≤ 40 }`, and anything invalid falls back. At most 10 AI-worded findings per person per day, counted from that person's `headsups` rows with `worded_by = 'ai'` created in the last 24 hours; beyond that, fallback wording.
5. **Push.** This is a separate pass on every run, after scanning, over all urgent heads-ups that are `new`, not snoozed and have `pushed_at` null, so one held back overnight is sent the next morning. For each, `push-rules.ts` decides:
   - notifications must be enabled and the person must have a push subscription
   - fewer than 2 `'headsup'` rows in `notification_log` for today's local date
   - local time between 07:00 and 22:00

   If allowed, claim the heads-up by setting `pushed_at` where it is still null, send with `pushToUser` (tag `orbis-headsup-<id>`, url `/?headsup=<id>`), and log it to `notification_log` with slot `'headsup'`. If not allowed because of the hour or the cap, a later run tries again. Heads-ups created more than 24 hours ago are never pushed; they stay on Today only.
6. **Time budget.** If the 50 s budget runs out, the loop stops. People not yet claimed are picked up next run.

## Today card

- **Placement.** After `FocusNote` and before `TodayWidgets` in `components/today/today-screen.tsx`. Loaded from a route handler, `/api/home/headsups`, in parallel with the brief and portfolio, like the other Today data.
- **Contents.** Up to 3 heads-ups that are `new` or `seen` and not snoozed, urgent first, then newest. "See all" expands the rest in place. With none, the card does not render.
- **Each heads-up shows:**
  - title and body
  - a provenance line, e.g. "From your spending · worded by AI" or "· worded by Orbis"
  - a primary button (the action label), **Snooze 3 days** and **Dismiss**
- **Marking seen.** Showing a heads-up marks it `seen`.
- **Push link.** `/?headsup=<id>` opens Today and scrolls to that heads-up.
- **Dismiss feedback.** After the third dismissal of the same kind within 30 days, the card offers once: "Stop checking for this?" Yes adds the kind to `disabled_kinds`.

**Settings → AI & privacy → Heads-ups:** one switch per kind (plain-language names), and "Clear all heads-ups", which deletes the person's rows.

## Privacy

- Checks run inside Orbis. The only thing sent to a model is one finding's `evidence` object: aggregates, a category, a merchant name, a routine title. Raw transactions, notes, journal text and health documents are never sent.
- Routing goes through the existing gates: `aiBlocked`, `ai_enabled` consent, `'personal'` sensitivity (so `may_train = false` providers only), and `ai_generation_events` logging.
- Nothing about heads-ups changes any connection's scope. Orbis still writes nothing to Gmail, Zerodha or Groww.

## Errors

| Failure | Behaviour |
|---|---|
| A check throws | Logged, skipped; other checks run |
| Router returns null, times out, or returns invalid output | Fallback wording, `worded_by = 'rules'` |
| Push fails | `notification_log` row marked `failed`; the heads-up stays on Today |
| Migration not applied | Scan route returns 500 with a generic message. `/api/home/headsups` returns an empty list, so Today renders unchanged |
| Time budget exceeded | Stop; unclaimed people run next time |

## Testing

- **Checks** (`lib/headsups/checks/*.test.ts`, vitest). Each kind gets:
  - a firing case
  - a near miss just under the threshold
  - an insufficient-history case
  - a disabled-kind case
  - stable `dedupeKey` across two runs on the same data
- **Push rules** (`push-rules.test.ts`). The cap, quiet hours at the edges, the timezone fallback, and normal-urgency findings never pushing.
- **Wording** (`word.test.ts`, with the router mocked):
  - the prompt contains only the kind, the evidence and the fallback
  - invalid or too-long output falls back
  - null from the router falls back
- **Scan.** The decisions live in a pure `plan.ts` (which people are due, what each finding does to the existing row, what gets pruned), so they are tested without a database:
  - `last_scan_date` claim
  - upsert behaviour for each status
  - 30-day dismissal hold
  - 60-day prune
  - one throwing check does not stop the others
- **E2E** (Playwright; `/api/home/headsups` is answered by `page.route` with one heads-up, since the suite runs against a real account):
  - it appears on Today
  - the primary action opens the prefilled spending form
  - Settings → AI & privacy lists the heads-up switches

## Phase 2 (separate spec, outline only)

- **Mail.** The scan reads important mail with the existing `IMPORTANT_MAIL_QUERY` and `isAlertMail` filter. One structured AI call per message decides whether it needs a reply or action, and by when, from sender, subject and snippet only. Messages waiting ≥ 2 days become `mail.needs_reply` (urgent when a deadline is near). The action is `draft_reply`: an AI-drafted reply, opened in Gmail by the person. Only the message ID and the reason are stored. This is where a structured-decision model such as TypeSafe's Jev could replace the LLM later, if its data terms allow personal data.
- **Investments.** A new `holding_snapshots` table (daily value per holding) is written by the scan. `invest.concentration` fires when one holding is > 25% of the portfolio. `invest.big_move` fires on a ≥ 8% weekly move and is urgent. The action opens Investments on that holding.

## Out of scope

- Autonomous actions, custom allow/ask/block rules, or any write to a connected service.
- Checks written by the AI, or free-form "what should I know?" scans.
- Heads-ups in the brief text or in the existing notification slots. The brief stays as it is.
- Tuning thresholds per person, beyond turning a kind off.
