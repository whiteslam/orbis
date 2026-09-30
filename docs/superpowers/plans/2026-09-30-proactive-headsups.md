# Proactive heads-ups (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orbis notices things in Money and Routines & health on its own, once a day, and shows them as heads-up cards on Today with the next step one tap away; urgent ones also push.

**Architecture:** Pure check functions turn loaded data into typed `Finding`s. A cron-called scan route runs them once a day per person, upserts them into a `headsups` table, words new ones through the existing AI router (falling back to fixed wording), and pushes urgent ones under a cap. Today reads them from a route handler; buttons only navigate or change a heads-up's status.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching route handlers or server actions — AGENTS.md), React 19, Supabase (RLS + service-role admin client), vitest with `node:assert/strict`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-proactive-headsups-design.md`

## Global Constraints

- Nothing reaches an AI provider unless `routeJson` allows it; every call uses `sensitivity: 'personal'` and `feature: 'headsups'`.
- The only data sent to a model is one finding's `kind`, `evidence` object and fallback wording.
- No writes to any connected service; actions only navigate or change `headsups.status` / `snoozed_until`.
- Every server entry point gets the user from `requireUser()` / `signedInSession()` + `isAppUnlocked`, never from the browser.
- Server actions return `{ success: boolean; message: string }`; unexpected errors go to `console.error`, the user gets generic copy.
- Migrations are idempotent (`if not exists`, `drop … if exists` before `create`).
- Tests: vitest, `import { test } from 'vitest'` + `import assert from 'node:assert/strict'`, files under `lib/**/*.test.ts`, relative `.ts` imports in tests.
- Limits: title ≤ 80, body ≤ 300, action label ≤ 40 chars; ≤ 10 AI-worded heads-ups per person per 24 h; ≤ 2 heads-up pushes per local day; pushes only 07:00–22:00 local; heads-ups older than 24 h never push; rows older than 60 days pruned; dismissed kinds held 30 days.
- The scan runs once per person per local day, at or after 06:00 local; timezone from `notification_preferences.timezone`, default `Asia/Kolkata`.
- Money dates are India time (`Asia/Kolkata`), like the rest of finance.

## Review Focus

1. **A brand-new account (no history)** — no check may fire; every check needs its minimum history. Pinned by the "insufficient history" test in each check task.
2. **A spend in a second currency** — money checks use only the most-used currency; a USD spend must not be compared with INR medians. Pinned in Task 2 (`dominant currency only`).
3. **An archived or inactive routine** — must never be flagged as slipping. Pinned in Task 3.
4. **A heads-up the person already dismissed** — the next day's scan must not bring it back for 30 days, and a `done` one never. Pinned in Task 5 (`mergeAction`).
5. **AI returns junk (prose, missing keys, 200-char title)** — fallback wording, never a broken card. Pinned in Task 4 (`parseWording`).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/202609300100_headsups.sql` | Tables, RLS, grants, `notification_log` changes |
| `supabase/cron/headsups_schedule.sql` | pg_cron job for the scan route |
| `lib/headsups/types.ts` | Kinds, urgencies, actions, `Finding`, `Headsup`, validators (client-safe) |
| `lib/headsups/dates.ts` | Pure local-date arithmetic |
| `lib/headsups/checks/money.ts` (+test) | Three money checks |
| `lib/headsups/checks/routines.ts` (+test) | `routine.slipping` |
| `lib/headsups/checks/health.ts` (+test) | `health.steps_down`, `health.plan_finished` |
| `lib/headsups/prompt.ts` (+test) | Prompt text and output validation (pure) |
| `lib/headsups/plan.ts` (+test) | Who is due, merge decisions, running checks safely (pure) |
| `lib/headsups/push-rules.ts` (+test) | May this heads-up push now? (pure) |
| `lib/headsups/word.ts` | Router call + fallback (server) |
| `lib/headsups/scan.ts` | Load, check, upsert, prune, push (server) |
| `lib/headsups/repository.ts` | Today list, preferences, status changes (server) |
| `app/api/headsups/scan/route.ts` | Cron entry point |
| `app/api/home/headsups/route.ts` | Today's list |
| `app/headsups/actions.ts` | Snooze, dismiss, complete, kind on/off, clear |
| `components/today/headsups.tsx` | The Today card |
| `components/settings/headsup-settings.tsx` | Settings → AI & privacy group |
| `app/styles/headsups.css` | Card styles |
| Modify: `components/today/today-screen.tsx`, `components/app-shell.tsx`, `components/money/money-screen.tsx`, `components/money/spending-screen.tsx`, `components/money/spending-summary.tsx`, `components/money/manual-transaction-form.tsx`, `components/health/health-screen.tsx`, `components/settings/settings-sheet.tsx`, `components/settings/routine-settings.tsx`, `app/layout.tsx`, `lib/account/deletion-plan.ts`, `docs/phase-1-owner-actions.md` |
| `tests/e2e/today/headsups.spec.ts` | E2E |

---

### Task 1: Migration, cron job and export

**Files:**
- Create: `supabase/migrations/202609300100_headsups.sql`
- Create: `supabase/cron/headsups_schedule.sql`
- Modify: `lib/account/deletion-plan.ts:39-65` (EXPORT_TABLES), `lib/account/deletion-plan.ts:27` (SINGLE_ROW_TABLES)
- Modify: `docs/phase-1-owner-actions.md` (append a section)
- Test: `lib/account/deletion-plan.test.ts`

**Interfaces:**
- Produces: tables `public.headsups`, `public.headsup_preferences`; `notification_log.slot` accepts `'headsup'`.

- [ ] **Step 1: Write the failing test** — append to `lib/account/deletion-plan.test.ts`:

```ts
test('the export includes heads-ups and their settings', () => {
  const byTable = new Map(EXPORT_TABLES.map((entry) => [entry.table, entry]));
  assert.equal(byTable.get('headsups')?.key, 'id');
  assert.equal(byTable.get('headsup_preferences')?.key, 'user_id');
});
```

(`EXPORT_TABLES`, `test` and `assert` are already imported in that file; check the import line and add `EXPORT_TABLES` if it is missing.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/account/deletion-plan.test.ts`
Expected: FAIL (`undefined !== 'id'`).

- [ ] **Step 3: Implement** — in `lib/account/deletion-plan.ts` add `'headsup_preferences'` to `SINGLE_ROW_TABLES` and append `'headsups', 'headsup_preferences',` to the `EXPORT_TABLES` list after `'journal_voice_notes',`.

- [ ] **Step 4: Write the migration** `supabase/migrations/202609300100_headsups.sql`:

```sql
-- Orbis: heads-ups, the things Orbis notices without being asked.
--
-- A scan (app/api/headsups/scan) writes rows with the service role; the owner
-- can read them and change only what they did about one (status, snooze).
-- Safe to run more than once.

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

create index if not exists headsups_user_status_idx on public.headsups (user_id, status, created_at desc);
create index if not exists headsups_push_idx on public.headsups (created_at) where urgency = 'urgent' and pushed_at is null;

drop trigger if exists headsups_set_updated_at on public.headsups;
create trigger headsups_set_updated_at
  before update on public.headsups
  for each row execute function public.set_updated_at();

alter table public.headsups enable row level security;
revoke all on public.headsups from public, anon, authenticated;
grant select on public.headsups to authenticated;
grant update (status, snoozed_until) on public.headsups to authenticated;
grant select, insert, update, delete on public.headsups to service_role;

drop policy if exists "Users read their own heads-ups" on public.headsups;
create policy "Users read their own heads-ups" on public.headsups
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users update their own heads-ups" on public.headsups;
create policy "Users update their own heads-ups" on public.headsups
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- One row per person: which kinds they turned off, and the day they were last
-- scanned. The row is created the first time Today asks for heads-ups, so the
-- scan only ever visits people who use Orbis.
create table if not exists public.headsup_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  disabled_kinds text[] not null default '{}',
  last_scan_date date,
  updated_at timestamptz not null default now()
);

drop trigger if exists headsup_preferences_set_updated_at on public.headsup_preferences;
create trigger headsup_preferences_set_updated_at
  before update on public.headsup_preferences
  for each row execute function public.set_updated_at();

alter table public.headsup_preferences enable row level security;
revoke all on public.headsup_preferences from public, anon, authenticated;
grant select on public.headsup_preferences to authenticated;
grant update (disabled_kinds) on public.headsup_preferences to authenticated;
grant select, insert, update, delete on public.headsup_preferences to service_role;

drop policy if exists "Users read their own heads-up settings" on public.headsup_preferences;
create policy "Users read their own heads-up settings" on public.headsup_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users update their own heads-up settings" on public.headsup_preferences;
create policy "Users update their own heads-up settings" on public.headsup_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Heads-up pushes are logged beside the daily slots. Several a day are allowed
-- (the cap lives in code), and headsups.pushed_at is what makes each one once-only.
alter table public.notification_log drop constraint if exists notification_log_slot_check;
alter table public.notification_log
  add constraint notification_log_slot_check
  check (slot in ('morning', 'lunch', 'evening', 'night', 'test', 'headsup'));

drop index if exists public.notification_log_one_per_slot_day;
create unique index if not exists notification_log_one_per_slot_day
  on public.notification_log (user_id, slot, local_date) where slot not in ('test', 'headsup');
```

- [ ] **Step 5: Write the cron job** `supabase/cron/headsups_schedule.sql` (same shape as `supabase/cron/notifications_schedule.sql`; read that file first and copy its header comment style and URL):

```sql
-- Runs the heads-up scan every 15 minutes. Each person is scanned once a day,
-- at or after 06:00 their time; runs in between only send pushes that were
-- waiting for the morning. Uses the same vault secret as the notifications job.
select cron.unschedule('orbis-headsups') where exists (select 1 from cron.job where jobname = 'orbis-headsups');
select cron.schedule(
  'orbis-headsups',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://orbis-starter.vercel.app/api/headsups/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orbis_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

- [ ] **Step 6: Document it** — append to `docs/phase-1-owner-actions.md`:

```markdown
## Heads-ups (2026-09-30)

1. Apply `supabase/migrations/202609300100_headsups.sql` before deploying the heads-ups code (Today reads an empty list until it exists).
2. After the deploy, run `supabase/cron/headsups_schedule.sql` in the SQL editor. It reuses the `orbis_cron_secret` vault secret; change the URL if the production domain differs.
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run lib/account/deletion-plan.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202609300100_headsups.sql supabase/cron/headsups_schedule.sql lib/account/deletion-plan.ts lib/account/deletion-plan.test.ts docs/phase-1-owner-actions.md
git commit -m "Heads-ups: tables, grants, cron job and export"
```

---

### Task 2: Types, dates and money checks

**Files:**
- Create: `lib/headsups/types.ts`, `lib/headsups/dates.ts`, `lib/headsups/checks/money.ts`
- Test: `lib/headsups/dates.test.ts`, `lib/headsups/checks/money.test.ts`

**Interfaces:**
- Produces (types.ts): `HEADSUP_KINDS`, `HeadsupKind`, `KIND_LABELS`, `URGENCY`, `HeadsupAction`, `Evidence`, `Finding`, `Headsup`, `isHeadsupKind(v)`, `parseAction(v)`.
- Produces (dates.ts): `addDays(date, n)`, `daysBetween(from, to)`, `weekday(date)`, `monthOf(date)`, `dayOfMonth(date)`, `mondayOf(date)`.
- Produces (money.ts): `type Expense = { id: string; amount: number; currency: string; category: string | null; merchant: string | null; localDate: string }`, `type MoneyInput = { today: string; expenses: Expense[] }`, `bigSpend(input): Finding[]`, `categoryHot(input): Finding[]`, `loggingGap(input): Finding[]`.

- [ ] **Step 1: Write `lib/headsups/types.ts`** (no test of its own; exercised by every check test):

```ts
// Heads-ups: what Orbis noticed, and the one step it has ready. Client-safe.

export const HEADSUP_KINDS = [
  'money.big_spend',
  'money.category_hot',
  'money.logging_gap',
  'routine.slipping',
  'health.steps_down',
  'health.plan_finished',
] as const;
export type HeadsupKind = (typeof HEADSUP_KINDS)[number];

/** How Settings names each check. */
export const KIND_LABELS: Record<HeadsupKind, string> = {
  'money.big_spend': 'A spend much bigger than usual',
  'money.category_hot': 'A category running ahead of its usual month',
  'money.logging_gap': 'Days with no spending logged',
  'routine.slipping': 'A routine missed several times in a row',
  'health.steps_down': 'Steps well below your usual',
  'health.plan_finished': 'A health plan that has finished',
};

/** Fixed in code: the model words a heads-up, it never decides how loud it is. */
export const URGENCY: Record<HeadsupKind, 'normal' | 'urgent'> = {
  'money.big_spend': 'urgent',
  'money.category_hot': 'normal',
  'money.logging_gap': 'normal',
  'routine.slipping': 'urgent',
  'health.steps_down': 'normal',
  'health.plan_finished': 'normal',
};

export type HeadsupAction =
  | { type: 'open_spending_entry'; category?: string }
  | { type: 'review_category'; category: string }
  | { type: 'adjust_routine'; routineId: string }
  | { type: 'open_health_plan'; planId: string }
  | { type: 'open_steps' };

export type Evidence = Record<string, string | number>;

export type Wording = { title: string; body: string; actionLabel: string };

export type Finding = {
  kind: HeadsupKind;
  dedupeKey: string;
  urgency: 'normal' | 'urgent';
  evidence: Evidence;
  action: HeadsupAction;
  fallback: Wording;
};

/** What Today renders. */
export type Headsup = {
  id: string;
  kind: HeadsupKind;
  urgency: 'normal' | 'urgent';
  title: string;
  body: string;
  action: HeadsupAction;
  actionLabel: string;
  wordedBy: 'ai' | 'rules';
  createdAt: string;
};

export function isHeadsupKind(value: unknown): value is HeadsupKind {
  return typeof value === 'string' && (HEADSUP_KINDS as readonly string[]).includes(value);
}

const text = (value: unknown, max = 120) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** An action read back from the database, or null if it is not one Orbis knows. */
export function parseAction(value: unknown): HeadsupAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'open_spending_entry':
      if (action.category === undefined) return { type: 'open_spending_entry' };
      return text(action.category) ? { type: 'open_spending_entry', category: action.category as string } : null;
    case 'review_category':
      return text(action.category) ? { type: 'review_category', category: action.category as string } : null;
    case 'adjust_routine':
      return text(action.routineId, 64) ? { type: 'adjust_routine', routineId: action.routineId as string } : null;
    case 'open_health_plan':
      return text(action.planId, 64) ? { type: 'open_health_plan', planId: action.planId as string } : null;
    case 'open_steps':
      return { type: 'open_steps' };
    default:
      return null;
  }
}
```

- [ ] **Step 2: Write the failing dates test** `lib/headsups/dates.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays, dayOfMonth, daysBetween, mondayOf, monthOf, weekday } from './dates.ts';

test('date arithmetic works on plain YYYY-MM-DD strings', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-09-26', '2026-09-30'), 4);
  assert.equal(weekday('2026-09-30'), 3, 'a Wednesday');
  assert.equal(monthOf('2026-09-30'), '2026-09');
  assert.equal(dayOfMonth('2026-09-07'), 7);
  assert.equal(mondayOf('2026-09-30'), '2026-09-28');
  assert.equal(mondayOf('2026-09-27'), '2026-09-21', 'Sunday belongs to the week before');
});
```

- [ ] **Step 3: Run it** — `npx vitest run lib/headsups/dates.test.ts` → FAIL (module not found).

- [ ] **Step 4: Write `lib/headsups/dates.ts`**:

```ts
// Local calendar dates as 'YYYY-MM-DD' strings. Arithmetic is done at UTC noon,
// so no timezone or daylight-saving shift can move a date by a day.

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

export function addDays(date: string, days: number) {
  const value = noon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}

export function daysBetween(from: string, to: string) {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000);
}

/** 0 = Sunday, as routines store it. */
export function weekday(date: string) {
  return noon(date).getUTCDay();
}

export function monthOf(date: string) {
  return date.slice(0, 7);
}

export function dayOfMonth(date: string) {
  return Number(date.slice(8, 10));
}

export function mondayOf(date: string) {
  return addDays(date, -((weekday(date) + 6) % 7));
}
```

- [ ] **Step 5: Run it** — `npx vitest run lib/headsups/dates.test.ts` → PASS.

- [ ] **Step 6: Write the failing money tests** `lib/headsups/checks/money.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays } from '../dates.ts';
import { bigSpend, categoryHot, loggingGap, type Expense } from './money.ts';

const TODAY = '2026-09-30';
let next = 0;
const spend = (localDate: string, amount: number, category: string | null = 'Food', extra: Partial<Expense> = {}): Expense => ({
  id: `e${next++}`, amount, currency: 'INR', category, merchant: 'Swiggy', localDate, ...extra,
});

// Five ordinary food spends of ~400 over the summer.
const usualFood = [10, 20, 30, 40, 50].map((back) => spend(addDays(TODAY, -back), 400));

test('big spend: fires on a recent spend at least 3x the category median', () => {
  const findings = bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1200)] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'money.big_spend');
  assert.equal(findings[0].urgency, 'urgent');
  assert.deepEqual(findings[0].action, { type: 'review_category', category: 'Food' });
  assert.equal(findings[0].evidence.usual, 400);
});

test('big spend: a near miss does not fire', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1190)] }).length, 0);
});

test('big spend: needs five earlier spends in the category', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood.slice(0, 4), spend(TODAY, 5000)] }).length, 0);
});

test('big spend: only today and yesterday count, so the first scan does not dig up old spends', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood, spend(addDays(TODAY, -2), 5000)] }).length, 0);
});

test('big spend: dominant currency only', () => {
  const findings = bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1500, 'Food', { currency: 'USD' })] });
  assert.equal(findings.length, 0, 'a USD spend is not compared with INR food');
});

test('big spend: the dedupe key is stable across runs', () => {
  const expenses = [...usualFood, spend(TODAY, 1200)];
  assert.equal(bigSpend({ today: TODAY, expenses })[0].dedupeKey, bigSpend({ today: TODAY, expenses })[0].dedupeKey);
});

// Three earlier months of ~3000 food by the 20th, and this month 4000 by the 20th.
const monthly = (month: string, amount: number) => [spend(`${month}-05`, amount / 2), spend(`${month}-15`, amount / 2)];
const history = [...monthly('2026-06', 3000), ...monthly('2026-07', 3000), ...monthly('2026-08', 3000)];

test('category hot: fires at 1.3x the usual month-to-date', () => {
  const findings = categoryHot({ today: '2026-09-20', expenses: [...history, ...monthly('2026-09', 4000)] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'money.category_hot:Food:2026-09');
  assert.equal(findings[0].evidence.thisMonth, 4000);
  assert.equal(findings[0].evidence.usual, 3000);
});

test('category hot: a near miss does not fire', () => {
  assert.equal(categoryHot({ today: '2026-09-20', expenses: [...history, ...monthly('2026-09', 3800)] }).length, 0);
});

test('category hot: waits until the 10th', () => {
  const early = [...history, spend('2026-09-02', 9000)];
  assert.equal(categoryHot({ today: '2026-09-09', expenses: early }).length, 0);
  assert.equal(categoryHot({ today: '2026-09-10', expenses: early }).length, 1);
});

test('category hot: needs spending in each of the three months before', () => {
  const partial = [...monthly('2026-07', 3000), ...monthly('2026-08', 3000), ...monthly('2026-09', 9000)];
  assert.equal(categoryHot({ today: '2026-09-20', expenses: partial }).length, 0);
});

// Logged every day from 6 to 25 September (20 of the 30 days up to the 25th), then nothing.
const habitual = Array.from({ length: 20 }, (_, index) => spend(addDays('2026-09-25', -index), 100, 'Food'));

test('logging gap: fires after 4 quiet days for someone who logs most days', () => {
  const findings = loggingGap({ today: TODAY, expenses: habitual });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'money.logging_gap:2026-09-25');
  assert.deepEqual(findings[0].action, { type: 'open_spending_entry' });
});

test('logging gap: three quiet days is not a gap', () => {
  assert.equal(loggingGap({ today: '2026-09-28', expenses: habitual }).length, 0);
});

test('logging gap: someone who rarely logs is not nagged', () => {
  const rare = [spend('2026-09-01', 100), spend('2026-09-10', 100), spend('2026-09-20', 100)];
  assert.equal(loggingGap({ today: TODAY, expenses: rare }).length, 0);
});

test('money checks: nothing at all is nothing to say', () => {
  assert.deepEqual([...bigSpend({ today: TODAY, expenses: [] }), ...categoryHot({ today: TODAY, expenses: [] }), ...loggingGap({ today: TODAY, expenses: [] })], []);
});
```

- [ ] **Step 7: Run them** — `npx vitest run lib/headsups/checks/money.test.ts` → FAIL (module not found).

- [ ] **Step 8: Write `lib/headsups/checks/money.ts`**:

```ts
import { money } from '../../finance/money.ts';
import { addDays, dayOfMonth, daysBetween, monthOf } from '../dates.ts';
import type { Finding } from '../types.ts';

export type Expense = { id: string; amount: number; currency: string; category: string | null; merchant: string | null; localDate: string };
export type MoneyInput = { today: string; expenses: Expense[] };

const BIG_SPEND_MULTIPLE = 3;
const BIG_SPEND_MIN_HISTORY = 5;
const BIG_SPEND_WINDOW_DAYS = 90;
const HOT_MULTIPLE = 1.3;
const HOT_FROM_DAY = 10;
const GAP_DAYS = 4;
const GAP_HABIT_SHARE = 0.6;

/** The Spending charts show one currency; the checks compare within it too. */
function inMainCurrency(expenses: Expense[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amount);
  const main = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { currency: main ?? 'INR', expenses: expenses.filter((expense) => expense.currency === main) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function bigSpend({ today, expenses: all }: MoneyInput): Finding[] {
  const { currency, expenses } = inMainCurrency(all);
  const since = addDays(today, -BIG_SPEND_WINDOW_DAYS);
  const recent = expenses.filter((expense) => expense.category && expense.localDate >= addDays(today, -1));
  return recent.flatMap((expense) => {
    const others = expenses.filter((other) => other.id !== expense.id && other.category === expense.category && other.localDate >= since);
    if (others.length < BIG_SPEND_MIN_HISTORY) return [];
    const usual = median(others.map((other) => other.amount));
    if (usual <= 0 || expense.amount < usual * BIG_SPEND_MULTIPLE) return [];
    const category = expense.category as string;
    const at = expense.merchant ? ` at ${expense.merchant}` : '';
    return [{
      kind: 'money.big_spend',
      dedupeKey: `money.big_spend:${expense.id}`,
      urgency: 'urgent',
      evidence: { category, amount: expense.amount, usual, currency, merchant: expense.merchant ?? '' },
      action: { type: 'review_category', category },
      fallback: {
        title: `A bigger ${category} spend than usual`,
        body: `${money(expense.amount, currency)}${at}. Your usual ${category} spend is about ${money(usual, currency)}.`,
        actionLabel: `See ${category}`,
      },
    } satisfies Finding];
  });
}

/** What was spent per category from day 1 to `day` of a month ('YYYY-MM'). */
function monthToDate(expenses: Expense[], month: string, day: number) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (!expense.category || monthOf(expense.localDate) !== month || dayOfMonth(expense.localDate) > day) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  }
  return totals;
}

function monthBefore(month: string, count: number) {
  const [year, index] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, index - 1 - count, 1));
  return value.toISOString().slice(0, 7);
}

export function categoryHot({ today, expenses: all }: MoneyInput): Finding[] {
  const day = dayOfMonth(today);
  if (day < HOT_FROM_DAY) return [];
  const { currency, expenses } = inMainCurrency(all);
  const month = monthOf(today);
  const previous = [1, 2, 3].map((count) => monthBefore(month, count));
  // Each earlier month needs some spending at all, or "usual" is a guess.
  if (!previous.every((earlier) => expenses.some((expense) => monthOf(expense.localDate) === earlier))) return [];
  const now = monthToDate(expenses, month, day);
  const before = previous.map((earlier) => monthToDate(expenses, earlier, day));
  return [...now].flatMap(([category, thisMonth]) => {
    const usual = before.reduce((sum, totals) => sum + (totals.get(category) ?? 0), 0) / before.length;
    if (usual <= 0 || thisMonth < usual * HOT_MULTIPLE) return [];
    return [{
      kind: 'money.category_hot',
      dedupeKey: `money.category_hot:${category}:${month}`,
      urgency: 'normal',
      evidence: { category, thisMonth, usual: Math.round(usual), day, currency },
      action: { type: 'review_category', category },
      fallback: {
        title: `${category} is running ahead this month`,
        body: `${money(thisMonth, currency)} so far, against about ${money(usual, currency)} by day ${day} in a usual month.`,
        actionLabel: `See ${category}`,
      },
    } satisfies Finding];
  });
}

export function loggingGap({ today, expenses }: MoneyInput): Finding[] {
  if (!expenses.length) return [];
  const days = [...new Set(expenses.map((expense) => expense.localDate))].sort();
  const last = days[days.length - 1];
  const quiet = daysBetween(last, today);
  if (quiet < GAP_DAYS) return [];
  const windowStart = addDays(last, -29);
  const logged = days.filter((day) => day >= windowStart && day <= last).length;
  if (logged < 30 * GAP_HABIT_SHARE) return [];
  return [{
    kind: 'money.logging_gap',
    dedupeKey: `money.logging_gap:${last}`,
    urgency: 'normal',
    evidence: { quietDays: quiet, loggedDaysBefore: logged },
    action: { type: 'open_spending_entry' },
    fallback: {
      title: `Nothing logged for ${quiet} days`,
      body: `You usually add spending most days. Anything from the last ${quiet} days to catch up on?`,
      actionLabel: 'Add a spend',
    },
  }];
}
```

Check before running: `lib/finance/money.ts` must have no `server-only` or `@/` imports (it doesn't: it exports only `money`). If vitest cannot resolve the relative `.ts` import, use `@/lib/finance/money` (the vitest config aliases `@`).

- [ ] **Step 9: Run tests** — `npx vitest run lib/headsups` → PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/headsups/types.ts lib/headsups/dates.ts lib/headsups/dates.test.ts lib/headsups/checks/money.ts lib/headsups/checks/money.test.ts
git commit -m "Heads-ups: types, date helpers and the money checks"
```

---

### Task 3: Routine and health checks

**Files:**
- Create: `lib/headsups/checks/routines.ts`, `lib/headsups/checks/health.ts`
- Test: `lib/headsups/checks/routines.test.ts`, `lib/headsups/checks/health.test.ts`

**Interfaces:**
- Consumes: `Finding` (types.ts), `addDays`, `daysBetween`, `weekday`, `mondayOf` (dates.ts).
- Produces: `type RoutineRow = { id: string; title: string; days: number[]; active: boolean; archivedAt: string | null; createdDate: string }`, `type RoutineEventRow = { routineId: string | null; localDate: string; status: 'done' | 'skipped' | 'other' }`, `routineSlipping({ today, routines, events }): Finding[]`; `type StepDay = { date: string; steps: number }`, `type PlanRow = { id: string; title: string; createdDate: string; durationWeeks: number }`, `stepsDown({ today, steps }): Finding[]`, `planFinished({ today, plan }): Finding[]`.

- [ ] **Step 1: Write the failing tests** `lib/headsups/checks/routines.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { routineSlipping, type RoutineEventRow, type RoutineRow } from './routines.ts';

// Wednesday 30 September 2026.
const TODAY = '2026-09-30';
const gym = (extra: Partial<RoutineRow> = {}): RoutineRow => ({
  id: 'r1', title: 'Gym', days: [1, 3, 5], active: true, archivedAt: null, createdDate: '2026-08-01', ...extra,
});
const done = (localDate: string): RoutineEventRow => ({ routineId: 'r1', localDate, status: 'done' });

test('slipping: the last three scheduled days with no done', () => {
  // Mon 28, Fri 25, Wed 23 were scheduled; nothing done.
  const findings = routineSlipping({ today: TODAY, routines: [gym()], events: [done('2026-09-21')] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].urgency, 'urgent');
  assert.deepEqual(findings[0].action, { type: 'adjust_routine', routineId: 'r1' });
  assert.equal(findings[0].dedupeKey, 'routine.slipping:r1:since:2026-09-21');
});

test('slipping: one done in the last three is not slipping', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym()], events: [done('2026-09-25')] }).length, 0);
});

test('slipping: skipped still counts as not done', () => {
  const skipped: RoutineEventRow[] = ['2026-09-23', '2026-09-25', '2026-09-28'].map((localDate) => ({ routineId: 'r1', localDate, status: 'skipped' }));
  assert.equal(routineSlipping({ today: TODAY, routines: [gym()], events: skipped }).length, 1);
});

test('slipping: a routine too new to have three scheduled days is left alone', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ createdDate: '2026-09-24' })], events: [] }).length, 0);
});

test('slipping: archived and inactive routines are never flagged', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ active: false })], events: [] }).length, 0);
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ archivedAt: '2026-09-01T00:00:00Z' })], events: [] }).length, 0);
});

test('slipping: the key stays the same while it keeps slipping', () => {
  const first = routineSlipping({ today: TODAY, routines: [gym()], events: [] })[0].dedupeKey;
  const later = routineSlipping({ today: '2026-10-02', routines: [gym()], events: [] })[0].dedupeKey;
  assert.equal(first, later);
  assert.equal(first, 'routine.slipping:r1:since:never');
});
```

`lib/headsups/checks/health.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays } from '../dates.ts';
import { planFinished, stepsDown, type StepDay } from './health.ts';

const TODAY = '2026-09-30';
// 35 days before today: 28 days at `before`, then 7 days at `recent`.
const steps = (before: number, recent: number, gaps = 0): StepDay[] => Array.from({ length: 35 }, (_, index) => {
  const date = addDays(TODAY, -35 + index);
  return { date, steps: index < 28 ? before : recent };
}).filter((_, index) => index < 35 - gaps);

test('steps down: 7-day average at or under 70% of the 28 days before', () => {
  const findings = stepsDown({ today: TODAY, steps: steps(10_000, 7_000) });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'health.steps_down:2026-09-28');
  assert.deepEqual(findings[0].action, { type: 'open_steps' });
});

test('steps down: a near miss does not fire', () => {
  assert.equal(stepsDown({ today: TODAY, steps: steps(10_000, 7_100) }).length, 0);
});

test('steps down: stale imports (under 5 recent days) are not a drop', () => {
  assert.equal(stepsDown({ today: TODAY, steps: steps(10_000, 1_000, 3) }).length, 0);
});

test('steps down: needs 14 days of history before', () => {
  const short = steps(10_000, 1_000).slice(20);
  assert.equal(stepsDown({ today: TODAY, steps: short }).length, 0);
});

const plan = { id: 'p1', title: 'Strength base', createdDate: '2026-08-01', durationWeeks: 8 };

test('plan finished: three days after its last day', () => {
  // 8 weeks from 1 August: the last day is 25 September, so it fires from the 28th.
  assert.equal(planFinished({ today: '2026-09-27', plan }).length, 0);
  const findings = planFinished({ today: '2026-09-28', plan });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].action, { type: 'open_health_plan', planId: 'p1' });
  assert.equal(findings[0].dedupeKey, 'health.plan_finished:p1');
});

test('plan finished: no plan, nothing to say', () => {
  assert.equal(planFinished({ today: TODAY, plan: null }).length, 0);
});
```

- [ ] **Step 2: Run them** — `npx vitest run lib/headsups/checks` → FAIL (modules not found).

- [ ] **Step 3: Write `lib/headsups/checks/routines.ts`**:

```ts
import { addDays, weekday } from '../dates.ts';
import type { Finding } from '../types.ts';

export type RoutineRow = { id: string; title: string; days: number[]; active: boolean; archivedAt: string | null; createdDate: string };
export type RoutineEventRow = { routineId: string | null; localDate: string; status: 'done' | 'skipped' | 'other' };

const MISSED_IN_A_ROW = 3;
const LOOK_BACK_DAYS = 14;

/** The last `count` days before today this routine was meant to happen, newest first. */
function lastScheduled(routine: RoutineRow, today: string, count: number) {
  const found: string[] = [];
  for (let back = 1; back <= LOOK_BACK_DAYS && found.length < count; back += 1) {
    const date = addDays(today, -back);
    if (date < routine.createdDate) break;
    if (routine.days.includes(weekday(date))) found.push(date);
  }
  return found;
}

export function routineSlipping({ today, routines, events }: { today: string; routines: RoutineRow[]; events: RoutineEventRow[] }): Finding[] {
  return routines.flatMap((routine) => {
    if (!routine.active || routine.archivedAt) return [];
    const scheduled = lastScheduled(routine, today, MISSED_IN_A_ROW);
    if (scheduled.length < MISSED_IN_A_ROW) return [];
    const doneDates = events.filter((event) => event.routineId === routine.id && event.status === 'done').map((event) => event.localDate).sort();
    if (scheduled.some((date) => doneDates.includes(date))) return [];
    // Keyed on the last time it was done, so one slump is one heads-up however long it lasts.
    const lastDone = doneDates[doneDates.length - 1] ?? 'never';
    return [{
      kind: 'routine.slipping',
      dedupeKey: `routine.slipping:${routine.id}:since:${lastDone}`,
      urgency: 'urgent',
      evidence: { routine: routine.title, missedInARow: MISSED_IN_A_ROW },
      action: { type: 'adjust_routine', routineId: routine.id },
      fallback: {
        title: `${routine.title} hasn’t happened lately`,
        body: `The last ${MISSED_IN_A_ROW} times it was due, it wasn’t marked done. A different time or fewer days might suit it better.`,
        actionLabel: 'Adjust it',
      },
    } satisfies Finding];
  });
}
```

Events are loaded for 14 days only, so `lastDone` is "never" when the last `done` is older than that. That still keeps the key stable through one slump, which is what matters.

- [ ] **Step 4: Write `lib/headsups/checks/health.ts`**:

```ts
import { addDays, mondayOf } from '../dates.ts';
import type { Finding } from '../types.ts';

export type StepDay = { date: string; steps: number };
export type PlanRow = { id: string; title: string; createdDate: string; durationWeeks: number };

const DROP_SHARE = 0.7;
const MIN_RECENT_DAYS = 5;
const MIN_BEFORE_DAYS = 14;
const PLAN_GRACE_DAYS = 3;

const average = (days: StepDay[]) => days.reduce((sum, day) => sum + day.steps, 0) / days.length;

export function stepsDown({ today, steps }: { today: string; steps: StepDay[] }): Finding[] {
  // Today is still being walked, so the week is the seven days before it.
  const recent = steps.filter((day) => day.date >= addDays(today, -7) && day.date < today);
  const before = steps.filter((day) => day.date >= addDays(today, -35) && day.date < addDays(today, -7));
  if (recent.length < MIN_RECENT_DAYS || before.length < MIN_BEFORE_DAYS) return [];
  const week = Math.round(average(recent));
  const usual = Math.round(average(before));
  if (usual <= 0 || week > usual * DROP_SHARE) return [];
  return [{
    kind: 'health.steps_down',
    dedupeKey: `health.steps_down:${mondayOf(today)}`,
    urgency: 'normal',
    evidence: { weekAverage: week, usualAverage: usual },
    action: { type: 'open_steps' },
    fallback: {
      title: 'Fewer steps this week',
      body: `About ${week.toLocaleString('en-IN')} a day this week, against your usual ${usual.toLocaleString('en-IN')}.`,
      actionLabel: 'See steps',
    },
  }];
}

export function planFinished({ today, plan }: { today: string; plan: PlanRow | null }): Finding[] {
  if (!plan) return [];
  const ends = addDays(plan.createdDate, Math.max(1, plan.durationWeeks) * 7 - 1);
  if (today < addDays(ends, PLAN_GRACE_DAYS)) return [];
  return [{
    kind: 'health.plan_finished',
    dedupeKey: `health.plan_finished:${plan.id}`,
    urgency: 'normal',
    evidence: { plan: plan.title, weeks: plan.durationWeeks },
    action: { type: 'open_health_plan', planId: plan.id },
    fallback: {
      title: `${plan.title} has finished`,
      body: `Your ${plan.durationWeeks}-week plan is done. Want to build what comes next?`,
      actionLabel: 'Open plans',
    },
  }];
}
```

The rule: a plan's last day is `createdDate + weeks × 7 − 1`, and it fires from `lastDay + 3`.

- [ ] **Step 5: Run tests** — `npx vitest run lib/headsups` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/headsups/checks/routines.ts lib/headsups/checks/routines.test.ts lib/headsups/checks/health.ts lib/headsups/checks/health.test.ts
git commit -m "Heads-ups: routine and health checks"
```

---

### Task 4: Prompt and output validation

**Files:**
- Create: `lib/headsups/prompt.ts`
- Test: `lib/headsups/prompt.test.ts`

**Interfaces:**
- Consumes: `Finding`, `Wording` (types.ts).
- Produces: `wordingPrompt(finding: Finding): { system: string; user: string }`, `parseWording(text: string): Wording | null`, `TITLE_MAX = 80`, `BODY_MAX = 300`, `LABEL_MAX = 40`.

- [ ] **Step 1: Write the failing test** `lib/headsups/prompt.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseWording, wordingPrompt } from './prompt.ts';
import type { Finding } from './types.ts';

const finding: Finding = {
  kind: 'money.category_hot',
  dedupeKey: 'money.category_hot:Food:2026-09',
  urgency: 'normal',
  evidence: { category: 'Food', thisMonth: 4000, usual: 3000, day: 20, currency: 'INR' },
  action: { type: 'review_category', category: 'Food' },
  fallback: { title: 'Food is running ahead this month', body: '₹4,000 so far.', actionLabel: 'See Food' },
};

test('the prompt carries the kind, the evidence and the fallback, and nothing else', () => {
  const { user } = wordingPrompt(finding);
  const sent = JSON.parse(user);
  assert.deepEqual(Object.keys(sent).sort(), ['evidence', 'fallback', 'kind']);
  assert.deepEqual(sent.evidence, finding.evidence);
  assert.equal(user.includes('dedupe'), false);
});

test('valid output is accepted and trimmed', () => {
  assert.deepEqual(parseWording('{"title":" Food is ahead ","body":"₹4,000 vs ₹3,000.","actionLabel":"See Food"}'), { title: 'Food is ahead', body: '₹4,000 vs ₹3,000.', actionLabel: 'See Food' });
});

test('junk falls back', () => {
  assert.equal(parseWording('Sure! Here is your heads-up.'), null);
  assert.equal(parseWording('{"title":"Hi","body":"x"}'), null, 'missing actionLabel');
  assert.equal(parseWording(JSON.stringify({ title: 'x'.repeat(81), body: 'b', actionLabel: 'a' })), null, 'title too long');
  assert.equal(parseWording(JSON.stringify({ title: 't', body: 'b'.repeat(301), actionLabel: 'a' })), null, 'body too long');
  assert.equal(parseWording(JSON.stringify({ title: 't', body: 'b', actionLabel: 'a'.repeat(41) })), null, 'label too long');
  assert.equal(parseWording(JSON.stringify({ title: '  ', body: 'b', actionLabel: 'a' })), null, 'blank title');
});
```

- [ ] **Step 2: Run it** — `npx vitest run lib/headsups/prompt.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/headsups/prompt.ts`**:

```ts
import type { Finding, Wording } from './types.ts';

export const TITLE_MAX = 80;
export const BODY_MAX = 300;
export const LABEL_MAX = 40;

const SYSTEM = [
  'You word short heads-ups for Orbis, a private personal app.',
  'You are given one thing Orbis noticed: its kind, the numbers behind it, and a plain default wording.',
  'Rewrite it to sound warm, specific and brief, like a thoughtful friend, never alarming or preachy.',
  'Use only the numbers given. Never add facts, advice about money products, or medical claims.',
  'Amounts are in the given currency; write them the way people in India would (₹14,200).',
  `Reply with JSON only: {"title": ≤${TITLE_MAX} chars, "body": ≤${BODY_MAX} chars, "actionLabel": ≤${LABEL_MAX} chars}.`,
  'The action label names the one next step, like the default does.',
].join('\n');

export function wordingPrompt(finding: Finding) {
  return {
    system: SYSTEM,
    user: JSON.stringify({ kind: finding.kind, evidence: finding.evidence, fallback: finding.fallback }),
  };
}

function field(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** The model's wording, or null to use Orbis's own. */
export function parseWording(text: string): Wording | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const title = field(record.title, TITLE_MAX);
  const body = field(record.body, BODY_MAX);
  const actionLabel = field(record.actionLabel, LABEL_MAX);
  return title && body && actionLabel ? { title, body, actionLabel } : null;
}
```

- [ ] **Step 4: Run it** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/headsups/prompt.ts lib/headsups/prompt.test.ts
git commit -m "Heads-ups: the wording prompt and its output check"
```

---

### Task 5: Scan decisions and push rules (pure)

**Files:**
- Create: `lib/headsups/plan.ts`, `lib/headsups/push-rules.ts`
- Test: `lib/headsups/plan.test.ts`, `lib/headsups/push-rules.test.ts`

**Interfaces:**
- Consumes: `localClock` from `lib/notifications/schedule.ts` (pure); `Finding`, `HeadsupKind` (types.ts).
- Produces (plan.ts): `SCAN_FROM_MINUTES = 360`, `DISMISS_HOLD_DAYS = 30`, `KEEP_DAYS = 60`, `AI_WORDED_PER_DAY = 10`, `localNow(now, timeZone): { date: string; minutes: number }`, `dueForScan(people: Array<{ userId: string; timeZone: string; lastScanDate: string | null }>, now: Date): Array<{ userId: string; localDate: string; timeZone: string }>`, `mergeAction(existing: { status: 'new' | 'seen' | 'done' | 'dismissed'; updatedAt: string } | null, now: Date): 'insert' | 'refresh' | 'revive' | 'skip'`, `runChecks(checks: Array<{ kind: HeadsupKind; run: () => Finding[] }>, disabled: string[]): { findings: Finding[]; failed: HeadsupKind[] }`, `pruneBefore(now: Date): string`.
- Produces (push-rules.ts): `PUSHES_PER_DAY = 2`, `mayPush(headsup: { urgency: 'normal' | 'urgent'; createdAt: string; pushedAt: string | null; snoozedUntil: string | null; status: string }, context: { pushesToday: number; localMinutes: number; notificationsEnabled: boolean; hasDevice: boolean }, now: Date): boolean`.

- [ ] **Step 1: Write the failing tests** `lib/headsups/plan.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dueForScan, localNow, mergeAction, pruneBefore, runChecks } from './plan.ts';
import type { Finding } from './types.ts';

// 00:30 UTC = 06:00 IST.
const at = (iso: string) => new Date(iso);

test('a person is due once a day, from 06:00 their time', () => {
  const people = [{ userId: 'a', timeZone: 'Asia/Kolkata', lastScanDate: '2026-09-29' }];
  assert.deepEqual(dueForScan(people, at('2026-09-30T00:29:00Z')), [], '05:59 IST');
  assert.deepEqual(dueForScan(people, at('2026-09-30T00:30:00Z')), [{ userId: 'a', localDate: '2026-09-30', timeZone: 'Asia/Kolkata' }]);
  assert.deepEqual(dueForScan([{ ...people[0], lastScanDate: '2026-09-30' }], at('2026-09-30T05:00:00Z')), [], 'already scanned today');
  assert.equal(dueForScan([{ ...people[0], lastScanDate: null }], at('2026-09-30T05:00:00Z')).length, 1, 'never scanned');
});

test('a bad timezone falls back to India time', () => {
  assert.equal(localNow(at('2026-09-30T00:30:00Z'), 'Not/AZone').minutes, 6 * 60);
});

test('what a finding does to the row already there', () => {
  const now = at('2026-09-30T06:00:00Z');
  assert.equal(mergeAction(null, now), 'insert');
  assert.equal(mergeAction({ status: 'new', updatedAt: '2026-09-29T06:00:00Z' }, now), 'refresh');
  assert.equal(mergeAction({ status: 'seen', updatedAt: '2026-09-29T06:00:00Z' }, now), 'refresh');
  assert.equal(mergeAction({ status: 'done', updatedAt: '2026-01-01T00:00:00Z' }, now), 'skip', 'done is final');
  assert.equal(mergeAction({ status: 'dismissed', updatedAt: '2026-09-01T06:00:01Z' }, now), 'skip', 'inside 30 days');
  assert.equal(mergeAction({ status: 'dismissed', updatedAt: '2026-08-31T06:00:00Z' }, now), 'revive', '30 days on');
});

const finding = (kind: Finding['kind']): Finding => ({
  kind, dedupeKey: kind, urgency: 'normal', evidence: {}, action: { type: 'open_steps' }, fallback: { title: 't', body: 'b', actionLabel: 'a' },
});

test('one check throwing does not stop the rest, and disabled kinds never run', () => {
  let ranDisabled = false;
  const result = runChecks([
    { kind: 'money.big_spend', run: () => { throw new Error('bad data'); } },
    { kind: 'health.steps_down', run: () => [finding('health.steps_down')] },
    { kind: 'routine.slipping', run: () => { ranDisabled = true; return [finding('routine.slipping')]; } },
  ], ['routine.slipping']);
  assert.deepEqual(result.findings.map((item) => item.kind), ['health.steps_down']);
  assert.deepEqual(result.failed, ['money.big_spend']);
  assert.equal(ranDisabled, false);
});

test('rows older than 60 days are pruned', () => {
  assert.equal(pruneBefore(at('2026-09-30T06:00:00Z')), '2026-08-01T06:00:00.000Z');
});
```

`lib/headsups/push-rules.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mayPush } from './push-rules.ts';

const now = new Date('2026-09-30T06:00:00Z');
const headsup = { urgency: 'urgent' as const, createdAt: '2026-09-30T01:00:00Z', pushedAt: null, snoozedUntil: null, status: 'new' };
const context = { pushesToday: 0, localMinutes: 11 * 60, notificationsEnabled: true, hasDevice: true };

test('an urgent, new heads-up pushes in the day', () => {
  assert.equal(mayPush(headsup, context, now), true);
});

test('only urgent ones push', () => {
  assert.equal(mayPush({ ...headsup, urgency: 'normal' }, context, now), false);
});

test('at most two a day', () => {
  assert.equal(mayPush(headsup, { ...context, pushesToday: 1 }, now), true);
  assert.equal(mayPush(headsup, { ...context, pushesToday: 2 }, now), false);
});

test('quiet from 22:00 until 07:00', () => {
  assert.equal(mayPush(headsup, { ...context, localMinutes: 7 * 60 - 1 }, now), false);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 7 * 60 }, now), true);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 22 * 60 - 1 }, now), true);
  assert.equal(mayPush(headsup, { ...context, localMinutes: 22 * 60 }, now), false);
});

test('never twice, never when seen, snoozed, stale or unwanted', () => {
  assert.equal(mayPush({ ...headsup, pushedAt: '2026-09-30T02:00:00Z' }, context, now), false);
  assert.equal(mayPush({ ...headsup, status: 'seen' }, context, now), false);
  assert.equal(mayPush({ ...headsup, snoozedUntil: '2026-10-02T00:00:00Z' }, context, now), false);
  assert.equal(mayPush({ ...headsup, createdAt: '2026-09-29T05:59:00Z' }, context, now), false, 'over 24 hours old');
  assert.equal(mayPush(headsup, { ...context, notificationsEnabled: false }, now), false);
  assert.equal(mayPush(headsup, { ...context, hasDevice: false }, now), false);
});
```

- [ ] **Step 2: Run them** — `npx vitest run lib/headsups/plan.test.ts lib/headsups/push-rules.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/headsups/plan.ts`**:

```ts
import { localClock } from '../notifications/schedule.ts';
import type { Finding, HeadsupKind } from './types.ts';

export const SCAN_FROM_MINUTES = 6 * 60;
export const DISMISS_HOLD_DAYS = 30;
export const KEEP_DAYS = 60;
export const AI_WORDED_PER_DAY = 10;
const DAY_MS = 86_400_000;

export function localNow(now: Date, timeZone: string) {
  try {
    return localClock(now, timeZone);
  } catch {
    return localClock(now, 'Asia/Kolkata');
  }
}

export function dueForScan(people: Array<{ userId: string; timeZone: string; lastScanDate: string | null }>, now: Date) {
  return people.flatMap(({ userId, timeZone, lastScanDate }) => {
    const clock = localNow(now, timeZone);
    if (clock.minutes < SCAN_FROM_MINUTES) return [];
    if (lastScanDate && lastScanDate >= clock.date) return [];
    return [{ userId, localDate: clock.date, timeZone }];
  });
}

export function mergeAction(existing: { status: 'new' | 'seen' | 'done' | 'dismissed'; updatedAt: string } | null, now: Date) {
  if (!existing) return 'insert' as const;
  if (existing.status === 'new' || existing.status === 'seen') return 'refresh' as const;
  if (existing.status === 'done') return 'skip' as const;
  const held = now.getTime() - new Date(existing.updatedAt).getTime() < DISMISS_HOLD_DAYS * DAY_MS;
  return held ? 'skip' as const : 'revive' as const;
}

export function runChecks(checks: Array<{ kind: HeadsupKind; run: () => Finding[] }>, disabled: string[]) {
  const findings: Finding[] = [];
  const failed: HeadsupKind[] = [];
  for (const check of checks) {
    if (disabled.includes(check.kind)) continue;
    try {
      findings.push(...check.run());
    } catch (error) {
      console.error(`Heads-up check ${check.kind} failed`, error);
      failed.push(check.kind);
    }
  }
  return { findings, failed };
}

export function pruneBefore(now: Date) {
  return new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
}
```

- [ ] **Step 4: Write `lib/headsups/push-rules.ts`**:

```ts
export const PUSHES_PER_DAY = 2;
const QUIET_UNTIL = 7 * 60;
const QUIET_FROM = 22 * 60;
const FRESH_MS = 24 * 60 * 60_000;

/** Whether one heads-up may go out as a push right now. Pure; the scan route supplies the facts. */
export function mayPush(
  headsup: { urgency: 'normal' | 'urgent'; createdAt: string; pushedAt: string | null; snoozedUntil: string | null; status: string },
  context: { pushesToday: number; localMinutes: number; notificationsEnabled: boolean; hasDevice: boolean },
  now: Date,
) {
  if (headsup.urgency !== 'urgent' || headsup.status !== 'new' || headsup.pushedAt) return false;
  if (headsup.snoozedUntil && new Date(headsup.snoozedUntil) > now) return false;
  if (now.getTime() - new Date(headsup.createdAt).getTime() > FRESH_MS) return false;
  if (!context.notificationsEnabled || !context.hasDevice) return false;
  if (context.pushesToday >= PUSHES_PER_DAY) return false;
  return context.localMinutes >= QUIET_UNTIL && context.localMinutes < QUIET_FROM;
}
```

- [ ] **Step 5: Run tests** — `npx vitest run lib/headsups` → PASS. If `lib/notifications/schedule.ts` fails to import in vitest because of the `.ts` suffix, use `@/lib/notifications/schedule`.

- [ ] **Step 6: Commit**

```bash
git add lib/headsups/plan.ts lib/headsups/plan.test.ts lib/headsups/push-rules.ts lib/headsups/push-rules.test.ts
git commit -m "Heads-ups: scan decisions and push rules"
```

---

### Task 6: Wording, scan and the cron route (server)

**Files:**
- Create: `lib/headsups/word.ts`, `lib/headsups/scan.ts`, `app/api/headsups/scan/route.ts`

**Interfaces:**
- Consumes: `routeJson` (`lib/ai/router.ts`), `aiAllowed` (`lib/ai/consent.ts`), `getAiConsent` (`lib/ai/consent-store.ts`), `pushToUser` (`lib/notifications/push.ts`), `createAdminClient` (`lib/supabase/admin.ts`), everything from Tasks 2–5.
- Produces: `wordFinding(userId: string, finding: Finding, aiBudgetLeft: boolean): Promise<Wording & { wordedBy: 'ai' | 'rules' }>`, `scanDue(admin, now, deadline): Promise<{ scanned: number; findings: number; failed: number }>`, `pushWaiting(admin, now, deadline): Promise<{ sent: number; held: number }>`.

These are I/O glue around tested pure code. Verify them by typecheck and by one manual run (Step 5).

- [ ] **Step 1: Write `lib/headsups/word.ts`**:

```ts
import 'server-only';

import { routeJson } from '@/lib/ai/router';
import { parseWording, wordingPrompt } from '@/lib/headsups/prompt';
import type { Finding, Wording } from '@/lib/headsups/types';

const TIMEOUT_MS = 10_000;

/**
 * A heads-up's words. The model sees one finding's numbers and Orbis's own
 * wording, nothing else, and only through the router (consent, then may_train
 * = false providers for 'personal'). Anything but clean JSON keeps Orbis's words.
 */
export async function wordFinding(userId: string, finding: Finding, aiBudgetLeft: boolean): Promise<Wording & { wordedBy: 'ai' | 'rules' }> {
  if (!aiBudgetLeft) return { ...finding.fallback, wordedBy: 'rules' };
  const { system, user } = wordingPrompt(finding);
  const result = await routeJson({ userId, feature: 'headsups', sensitivity: 'personal', system, user, maxTokens: 300, temperature: 0.3, timeoutMs: TIMEOUT_MS });
  const wording = result ? parseWording(result.text) : null;
  return wording ? { ...wording, wordedBy: 'ai' } : { ...finding.fallback, wordedBy: 'rules' };
}
```

`routeJson` checks consent itself, so there is no separate `aiBlocked` call here: with AI off it returns null and the fallback is used.

- [ ] **Step 2: Write `lib/headsups/scan.ts`**:

```ts
import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { bigSpend, categoryHot, loggingGap, type Expense } from '@/lib/headsups/checks/money';
import { routineSlipping, type RoutineEventRow, type RoutineRow } from '@/lib/headsups/checks/routines';
import { planFinished, stepsDown, type PlanRow, type StepDay } from '@/lib/headsups/checks/health';
import { addDays } from '@/lib/headsups/dates';
import { AI_WORDED_PER_DAY, dueForScan, localNow, mergeAction, pruneBefore, runChecks } from '@/lib/headsups/plan';
import { mayPush } from '@/lib/headsups/push-rules';
import { wordFinding } from '@/lib/headsups/word';
import type { Finding } from '@/lib/headsups/types';
import { localClock } from '@/lib/notifications/schedule';
import { pushToUser } from '@/lib/notifications/push';

type Admin = ReturnType<typeof createAdminClient>;
const INDIA = 'Asia/Kolkata';

const indiaDate = (iso: string) => localClock(new Date(iso), INDIA).date;

/** Everything the checks read for one person, loaded once. */
async function loadInput(admin: Admin, userId: string, today: string) {
  // Four calendar months back covers "the three months before this one" and the 90-day median.
  const since = `${addDays(today, -125)}T00:00:00Z`;
  const [expenses, routines, events, steps, plans] = await Promise.all([
    admin.from('transactions').select('id,amount,currency,category,merchant,occurred_at').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', since).limit(5000),
    admin.from('routines').select('id,title,days,active,archived_at,created_at').eq('user_id', userId),
    admin.from('routine_events').select('routine_id,local_date,status').eq('user_id', userId).gte('local_date', addDays(today, -14)),
    admin.from('health_daily_steps').select('date,steps').eq('user_id', userId).gte('date', addDays(today, -35)),
    admin.from('health_plans').select('id,title,plan,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
  ]);
  const newest = plans.data?.[0];
  return {
    expenses: (expenses.data ?? []).map((row): Expense => ({ id: row.id, amount: Number(row.amount), currency: row.currency, category: row.category, merchant: row.merchant, localDate: indiaDate(row.occurred_at) })),
    routines: (routines.data ?? []).map((row): RoutineRow => ({ id: row.id, title: row.title, days: row.days, active: row.active, archivedAt: row.archived_at, createdDate: indiaDate(row.created_at) })),
    events: (events.data ?? []).map((row): RoutineEventRow => ({ routineId: row.routine_id, localDate: row.local_date, status: row.status })),
    steps: (steps.data ?? []).map((row): StepDay => ({ date: row.date, steps: row.steps })),
    plan: newest ? ({ id: newest.id, title: newest.title, createdDate: indiaDate(newest.created_at), durationWeeks: Number((newest.plan as { durationWeeks?: number })?.durationWeeks) || 1 } satisfies PlanRow) : null,
  };
}

async function saveFindings(admin: Admin, userId: string, findings: Finding[], now: Date) {
  if (!findings.length) return 0;
  const { data: existing } = await admin.from('headsups').select('id,dedupe_key,status,updated_at').eq('user_id', userId).in('dedupe_key', findings.map((item) => item.dedupeKey));
  const byKey = new Map((existing ?? []).map((row) => [row.dedupe_key as string, row]));
  const { count: worded } = await admin.from('headsups').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('worded_by', 'ai').gte('created_at', new Date(now.getTime() - 86_400_000).toISOString());
  let aiLeft = AI_WORDED_PER_DAY - (worded ?? 0);
  let saved = 0;
  for (const finding of findings) {
    const row = byKey.get(finding.dedupeKey);
    const action = mergeAction(row ? { status: row.status, updatedAt: row.updated_at } : null, now);
    if (action === 'skip') continue;
    if (action === 'refresh') {
      await admin.from('headsups').update({ evidence: finding.evidence }).eq('id', row!.id);
      continue;
    }
    const wording = await wordFinding(userId, finding, aiLeft > 0);
    if (wording.wordedBy === 'ai') aiLeft -= 1;
    const values = {
      user_id: userId, kind: finding.kind, dedupe_key: finding.dedupeKey, urgency: finding.urgency, evidence: finding.evidence,
      title: wording.title, body: wording.body, action: finding.action, action_label: wording.actionLabel, worded_by: wording.wordedBy,
      status: 'new', snoozed_until: null, pushed_at: null, created_at: now.toISOString(),
    };
    const { error } = action === 'insert'
      ? await admin.from('headsups').insert(values)
      : await admin.from('headsups').update(values).eq('id', row!.id);
    if (error) console.error('Saving a heads-up failed', error);
    else saved += 1;
  }
  return saved;
}

/** Scans everyone due, until the deadline. The rest are picked up by the next run. */
export async function scanDue(admin: Admin, now: Date, deadline: number) {
  const [prefs, notify] = await Promise.all([
    admin.from('headsup_preferences').select('user_id,disabled_kinds,last_scan_date'),
    admin.from('notification_preferences').select('user_id,timezone'),
  ]);
  if (prefs.error) throw new Error('Heads-up preferences could not be loaded.');
  const zones = new Map((notify.data ?? []).map((row) => [row.user_id as string, row.timezone as string]));
  const people = (prefs.data ?? []).map((row) => ({ userId: row.user_id as string, timeZone: zones.get(row.user_id) ?? INDIA, lastScanDate: row.last_scan_date as string | null, disabled: (row.disabled_kinds ?? []) as string[] }));
  const disabledBy = new Map(people.map((person) => [person.userId, person.disabled]));
  const counts = { scanned: 0, findings: 0, failed: 0 };

  for (const person of dueForScan(people, now)) {
    if (Date.now() > deadline) break;
    // Claim the day first, so an overlapping run skips this person.
    const { data: claimed } = await admin.from('headsup_preferences').update({ last_scan_date: person.localDate }).eq('user_id', person.userId)
      .or(`last_scan_date.is.null,last_scan_date.lt.${person.localDate}`).select('user_id');
    if (!claimed?.length) continue;
    try {
      const today = person.localDate;
      const input = await loadInput(admin, person.userId, today);
      const moneyInput = { today, expenses: input.expenses };
      const { findings, failed } = runChecks([
        { kind: 'money.big_spend', run: () => bigSpend(moneyInput) },
        { kind: 'money.category_hot', run: () => categoryHot(moneyInput) },
        { kind: 'money.logging_gap', run: () => loggingGap(moneyInput) },
        { kind: 'routine.slipping', run: () => routineSlipping({ today, routines: input.routines, events: input.events }) },
        { kind: 'health.steps_down', run: () => stepsDown({ today, steps: input.steps }) },
        { kind: 'health.plan_finished', run: () => planFinished({ today, plan: input.plan }) },
      ], disabledBy.get(person.userId) ?? []);
      counts.findings += await saveFindings(admin, person.userId, findings, now);
      counts.failed += failed.length;
      await admin.from('headsups').delete().eq('user_id', person.userId).lt('created_at', pruneBefore(now));
      counts.scanned += 1;
    } catch (error) {
      console.error('Heads-up scan failed for a person', error);
      counts.failed += 1;
    }
  }
  return counts;
}

/** Sends urgent heads-ups that are allowed out now: new ones, and ones held overnight. */
export async function pushWaiting(admin: Admin, now: Date, deadline: number) {
  const { data: waiting } = await admin.from('headsups').select('id,user_id,urgency,status,title,body,worded_by,created_at,pushed_at,snoozed_until')
    .eq('urgency', 'urgent').eq('status', 'new').is('pushed_at', null).gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()).order('created_at').limit(50);
  const counts = { sent: 0, held: 0 };
  for (const headsup of waiting ?? []) {
    if (Date.now() > deadline) break;
    const [prefs, devices] = await Promise.all([
      admin.from('notification_preferences').select('enabled,timezone').eq('user_id', headsup.user_id).maybeSingle(),
      admin.from('push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('user_id', headsup.user_id),
    ]);
    const clock = localNow(now, prefs.data?.timezone ?? INDIA);
    const { count: pushesToday } = await admin.from('notification_log').select('id', { count: 'exact', head: true }).eq('user_id', headsup.user_id).eq('slot', 'headsup').eq('local_date', clock.date);
    const allowed = mayPush(
      { urgency: headsup.urgency, createdAt: headsup.created_at, pushedAt: headsup.pushed_at, snoozedUntil: headsup.snoozed_until, status: headsup.status },
      { pushesToday: pushesToday ?? 0, localMinutes: clock.minutes, notificationsEnabled: Boolean(prefs.data?.enabled), hasDevice: (devices.count ?? 0) > 0 },
      now,
    );
    if (!allowed) {
      counts.held += 1;
      continue;
    }
    const { data: claimed } = await admin.from('headsups').update({ pushed_at: now.toISOString() }).eq('id', headsup.id).is('pushed_at', null).select('id');
    if (!claimed?.length) continue;
    const push = await pushToUser(admin, headsup.user_id, { title: headsup.title, body: headsup.body, tag: `orbis-headsup-${headsup.id}`.slice(0, 64), url: `/?headsup=${headsup.id}` });
    await admin.from('notification_log').insert({
      user_id: headsup.user_id, slot: 'headsup', local_date: clock.date, status: push.sent > 0 ? 'sent' : 'failed',
      title: headsup.title.slice(0, 80), body: headsup.body.slice(0, 300), source: headsup.worded_by, devices_sent: push.sent,
    });
    if (push.sent > 0) counts.sent += 1;
  }
  return counts;
}
```

If the generated Supabase types make `.select(...)` rows `any`-free and a field is typed `unknown`, add a narrow cast at the map (as shown for `plan`). Do not add a types regeneration step.

- [ ] **Step 3: Write `app/api/headsups/scan/route.ts`** (read `node_modules/next/dist/docs/` for route handlers first, and mirror `app/api/notifications/dispatch/route.ts`):

```ts
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushWaiting, scanDue } from '@/lib/headsups/scan';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// Called every 15 minutes by pg_cron (supabase/cron/headsups_schedule.sql).
// Scans each person once a day, then sends any urgent heads-ups allowed out now.
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const admin = createAdminClient();
  try {
    const scan = await scanDue(admin, now, deadline);
    const push = await pushWaiting(admin, now, deadline);
    return Response.json({ ...scan, ...push });
  } catch (error) {
    console.error('Heads-up scan failed', error);
    return Response.json({ error: 'The scan could not run.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors in the new files.

- [ ] **Step 5: Manual check (needs the migration applied to a dev database and `CRON_SECRET` in `.env.local`)**

```bash
pnpm dev
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/headsups/scan
```

Expected: JSON like `{"scanned":0,"findings":0,"failed":0,"sent":0,"held":0}` (0 scanned until a `headsup_preferences` row exists, which Task 7 creates). If there is no dev database, record that this step was not run.

- [ ] **Step 6: Commit**

```bash
git add lib/headsups/word.ts lib/headsups/scan.ts app/api/headsups/scan/route.ts
git commit -m "Heads-ups: the daily scan, AI wording and urgent pushes"
```

---

### Task 7: Today's list, the actions and the card

**Files:**
- Create: `lib/headsups/repository.ts`, `app/api/home/headsups/route.ts`, `app/headsups/actions.ts`, `components/today/headsups.tsx`, `app/styles/headsups.css`
- Modify: `app/layout.tsx:20` (add the stylesheet import), `components/today/today-screen.tsx` (render the card; new `openHeadsup` prop)

**Interfaces:**
- Consumes: `Headsup`, `HeadsupAction`, `HeadsupKind`, `parseAction`, `isHeadsupKind` (types.ts); `requireUser` (`lib/auth/session.ts`); `homeRequester`, `NO_STORE` (`lib/home/route-auth.ts`).
- Produces: `type HeadsupsResponse = { state: 'ready' | 'setup'; headsups: Headsup[]; disabledKinds: HeadsupKind[]; offerOff: HeadsupKind[] }` (in repository.ts, re-exported type-only for the client from types.ts — put the type in `types.ts`); server actions `snoozeHeadsupAction(id)`, `dismissHeadsupAction(id)`, `completeHeadsupAction(id)`, `setHeadsupKindAction(kind, enabled)`, `clearHeadsupsAction()`, each `Promise<{ success: boolean; message: string }>`; component `<Headsups onAction={(action: HeadsupAction) => void} />`; `TodayScreen` gains prop `openHeadsup: (action: HeadsupAction) => void`.

- [ ] **Step 1: Add the response type to `lib/headsups/types.ts`**:

```ts
export type HeadsupsResponse = { state: 'ready' | 'setup'; headsups: Headsup[]; disabledKinds: HeadsupKind[]; offerOff: HeadsupKind[] };
```

- [ ] **Step 2: Write `lib/headsups/repository.ts`**:

```ts
import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isHeadsupKind, parseAction, type Headsup, type HeadsupKind, type HeadsupsResponse } from '@/lib/headsups/types';

const LIST_LIMIT = 20;
const OFFER_OFF_AFTER = 3;
const OFFER_WINDOW_MS = 30 * 86_400_000;

/**
 * Today's heads-ups. Also creates the person's preferences row the first time,
 * which is what puts them on the daily scan. Showing a heads-up marks it seen.
 * Uses the admin client with an explicit user_id filter, like the other Home
 * reads that run from route handlers.
 */
export async function listHeadsups(userId: string): Promise<HeadsupsResponse> {
  const admin = createAdminClient();
  const empty: HeadsupsResponse = { state: 'ready', headsups: [], disabledKinds: [], offerOff: [] };
  const prefsInsert = await admin.from('headsup_preferences').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (prefsInsert.error) {
    // 42P01: the migration is not applied yet. Today simply has no card.
    if (prefsInsert.error.code === '42P01') return { ...empty, state: 'setup' };
    console.error('Heads-up preferences could not be created', prefsInsert.error);
    return empty;
  }
  const now = new Date().toISOString();
  const [rows, prefs, dismissed] = await Promise.all([
    admin.from('headsups').select('id,kind,urgency,title,body,action,action_label,worded_by,status,created_at').eq('user_id', userId)
      .in('status', ['new', 'seen']).or(`snoozed_until.is.null,snoozed_until.lt."${now}"`)
      .order('urgency', { ascending: false }).order('created_at', { ascending: false }).limit(LIST_LIMIT),
    admin.from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle(),
    admin.from('headsups').select('kind').eq('user_id', userId).eq('status', 'dismissed').gte('updated_at', new Date(Date.now() - OFFER_WINDOW_MS).toISOString()),
  ]);
  if (rows.error) {
    console.error('Heads-ups could not be loaded', rows.error);
    return empty;
  }
  const disabledKinds = ((prefs.data?.disabled_kinds ?? []) as string[]).filter(isHeadsupKind);
  const headsups = (rows.data ?? []).flatMap((row): Headsup[] => {
    const action = parseAction(row.action);
    if (!action || !isHeadsupKind(row.kind)) return [];
    return [{ id: row.id, kind: row.kind, urgency: row.urgency, title: row.title, body: row.body, action, actionLabel: row.action_label, wordedBy: row.worded_by, createdAt: row.created_at }];
  });
  const fresh = (rows.data ?? []).filter((row) => row.status === 'new').map((row) => row.id);
  if (fresh.length) await admin.from('headsups').update({ status: 'seen' }).eq('user_id', userId).in('id', fresh).eq('status', 'new');
  const counts = new Map<string, number>();
  for (const row of dismissed.data ?? []) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  const offerOff = [...counts].filter(([kind, count]) => count >= OFFER_OFF_AFTER && isHeadsupKind(kind) && !disabledKinds.includes(kind)).map(([kind]) => kind as HeadsupKind);
  return { state: 'ready', headsups, disabledKinds, offerOff };
}
```

- [ ] **Step 3: Write `app/api/home/headsups/route.ts`** (mirror `app/api/home/mail/route.ts`):

```ts
import { listHeadsups } from '@/lib/headsups/repository';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/headsups → what Orbis noticed, for Today's card.
export async function GET() {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  try {
    return Response.json(await listHeadsups(requester.userId), { headers: NO_STORE });
  } catch (error) {
    console.error('Home heads-ups failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
```

- [ ] **Step 4: Write `app/headsups/actions.ts`** (mirror `app/ai/result-actions.ts`; the user's own client is used so RLS and the column grants apply):

```ts
'use server';

import { APP_LOCK_MESSAGE, isAppUnlocked } from '@/lib/security/app-lock';
import { signedInSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { isHeadsupKind } from '@/lib/headsups/types';
import { isUuid } from '@/lib/validate/id';

type Result = { success: boolean; message: string };
const SNOOZE_MS = 3 * 86_400_000;

async function session() {
  const current = await signedInSession();
  if (!current) return { error: 'Sign in again to do this.' } as const;
  if (!(await isAppUnlocked(current.claims))) return { error: APP_LOCK_MESSAGE } as const;
  return current;
}

async function setStatus(id: unknown, change: { status?: 'done' | 'dismissed'; snoozed_until?: string }, done: string): Promise<Result> {
  if (!isUuid(id)) return { success: false, message: 'That heads-up could not be found.' };
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { data, error } = await current.supabase.from('headsups').update(change).eq('id', id).eq('user_id', current.userId).select('id');
  if (error || !data?.length) {
    if (error) console.error('Updating a heads-up failed', error);
    return { success: false, message: 'That heads-up could not be updated. Try again.' };
  }
  return { success: true, message: done };
}

export async function snoozeHeadsupAction(id: unknown) {
  return setStatus(id, { snoozed_until: new Date(Date.now() + SNOOZE_MS).toISOString() }, 'Snoozed for 3 days.');
}

export async function dismissHeadsupAction(id: unknown) {
  return setStatus(id, { status: 'dismissed' }, 'Dismissed.');
}

export async function completeHeadsupAction(id: unknown) {
  return setStatus(id, { status: 'done' }, 'Done.');
}

export async function setHeadsupKindAction(kind: unknown, enabled: unknown): Promise<Result> {
  if (!isHeadsupKind(kind) || typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be changed.' };
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { data, error } = await current.supabase.from('headsup_preferences').select('disabled_kinds').eq('user_id', current.userId).maybeSingle();
  if (error || !data) return { success: false, message: 'Heads-up settings aren’t available yet. Open Today once, then try again.' };
  const disabled = new Set<string>(data.disabled_kinds ?? []);
  if (enabled) disabled.delete(kind); else disabled.add(kind);
  const saved = await current.supabase.from('headsup_preferences').update({ disabled_kinds: [...disabled] }).eq('user_id', current.userId);
  if (saved.error) {
    console.error('Saving heads-up settings failed', saved.error);
    return { success: false, message: 'That setting could not be saved. Try again.' };
  }
  return { success: true, message: enabled ? 'Orbis will check for this again.' : 'Orbis will stop checking for this.' };
}

/** Deletes every heads-up. The owner has no delete grant, so this uses the admin client, scoped to them. */
export async function clearHeadsupsAction(): Promise<Result> {
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { error } = await createAdminClient().from('headsups').delete().eq('user_id', current.userId);
  if (error) {
    console.error('Clearing heads-ups failed', error);
    return { success: false, message: 'Heads-ups could not be cleared. Try again.' };
  }
  return { success: true, message: 'All heads-ups cleared.' };
}
```

- [ ] **Step 5: Write `components/today/headsups.tsx`**:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { completeHeadsupAction, dismissHeadsupAction, setHeadsupKindAction, snoozeHeadsupAction } from '@/app/headsups/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { Headsup, HeadsupAction, HeadsupKind, HeadsupsResponse } from '@/lib/headsups/types';

const SHOWN = 3;

const SOURCE: Record<string, string> = { money: 'your spending', routine: 'your routines', health: 'your health data' };

function source(headsup: Headsup) {
  const from = SOURCE[headsup.kind.split('.')[0]] ?? 'your data';
  return `From ${from} · worded by ${headsup.wordedBy === 'ai' ? 'AI' : 'Orbis'}`;
}

/** What Orbis noticed without being asked. Renders nothing when there is nothing. */
export function Headsups({ onAction }: { onAction: (action: HeadsupAction) => void }) {
  const [data, setData] = useState<HeadsupsResponse | null>(null);
  const [all, setAll] = useState(false);
  const [offer, setOffer] = useState<HeadsupKind | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void fetch('/api/home/headsups', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() as Promise<HeadsupsResponse> : null))
      .then((result) => { if (live && result) setData(result); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // A push opens /?headsup=<id>; bring that one into view once it has loaded.
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('headsup');
    if (!id || !data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAll(true);
    requestAnimationFrame(() => document.getElementById(`headsup-${id}`)?.scrollIntoView({ block: 'center' }));
  }, [data]);

  if (!data || !data.headsups.length) return null;
  const shown = all ? data.headsups : data.headsups.slice(0, SHOWN);

  function remove(id: string) {
    setData((current) => current && { ...current, headsups: current.headsups.filter((item) => item.id !== id) });
  }

  function act(headsup: Headsup, kind: 'go' | 'snooze' | 'dismiss') {
    remove(headsup.id);
    if (kind === 'dismiss' && data?.offerOff.includes(headsup.kind)) setOffer(headsup.kind);
    const action = kind === 'go' ? completeHeadsupAction : kind === 'snooze' ? snoozeHeadsupAction : dismissHeadsupAction;
    startTransition(async () => { await safeAction(action)(headsup.id); });
    if (kind === 'go') onAction(headsup.action);
  }

  return (
    <section className="hu-card" aria-labelledby="headsups-title">
      <h2 id="headsups-title" className="fd-label">Heads-ups</h2>
      {shown.map((headsup) => (
        <article className={`hu-item${headsup.urgency === 'urgent' ? ' urgent' : ''}`} id={`headsup-${headsup.id}`} key={headsup.id}>
          <strong>{headsup.title}</strong>
          <p>{headsup.body}</p>
          <small>{source(headsup)}</small>
          <div className="hu-actions">
            <button type="button" className="fd-button" onClick={() => act(headsup, 'go')}>{headsup.actionLabel}</button>
            <button type="button" className="hu-quiet" onClick={() => act(headsup, 'snooze')}>Snooze 3 days</button>
            <button type="button" className="hu-quiet" onClick={() => act(headsup, 'dismiss')}>Dismiss</button>
          </div>
        </article>
      ))}
      {!all && data.headsups.length > SHOWN && (
        <button type="button" className="hu-more" onClick={() => setAll(true)}>See all {data.headsups.length}</button>
      )}
      {offer && (
        <div className="hu-offer" role="status">
          <span>You’ve dismissed this a few times. Stop checking for it?</span>
          <button type="button" className="hu-quiet" onClick={() => { const kind = offer; setOffer(null); startTransition(async () => { await safeAction(setHeadsupKindAction)(kind, false); }); }}>Stop checking</button>
          <button type="button" className="hu-quiet" onClick={() => setOffer(null)}>Keep it</button>
        </div>
      )}
    </section>
  );
}
```

Before writing, read `lib/client/safe-action.ts` to confirm `safeAction(fn)(...args)` is its call shape (it is used that way in `manual-transaction-form.tsx`). If it takes a single argument only, wrap: `safeAction(() => action(headsup.id))()`.

- [ ] **Step 6: Write `app/styles/headsups.css`** and import it in `app/layout.tsx` after `glass-dark.css`:

```css
/* Today's heads-ups: one frosted card, one row per heads-up. */
.hu-card { margin-top: 14px; padding: 16px 18px; border-radius: 26px; background: var(--glass-bg, color-mix(in srgb, var(--fd-ink) 4%, transparent)); }
.hu-item { padding: 12px 0; border-bottom: 1px solid color-mix(in srgb, var(--fd-ink) 7%, transparent); }
.hu-item:last-of-type { border-bottom: 0; }
.hu-item strong { display: block; font-size: 15px; font-weight: 650; color: var(--fd-ink); }
.hu-item.urgent strong::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: var(--fd-accent, #e4572e); vertical-align: 2px; }
.hu-item p { margin: 6px 0 4px; font-size: 13.5px; line-height: 1.55; color: var(--fd-soft); }
.hu-item small { font-size: 11.5px; color: var(--fd-soft); }
.hu-actions, .hu-offer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; }
.hu-quiet, .hu-more { border: 0; background: none; padding: 6px 2px; font-size: 12.5px; font-weight: 600; color: var(--fd-soft); cursor: pointer; }
.hu-offer span { flex-basis: 100%; font-size: 12.5px; color: var(--fd-ink); }
```

Before writing, grep `app/styles/glass.css` for the variable its `.fd-quiet` card uses for the frosted background and use that instead of the `--glass-bg` fallback, so the card matches the other Today cards in light and dark. Check the result in both themes.

- [ ] **Step 7: Render it on Today** — in `components/today/today-screen.tsx`:
  - import `{ Headsups }` from `@/components/today/headsups` and `type { HeadsupAction }` from `@/lib/headsups/types`;
  - add `openHeadsup: (action: HeadsupAction) => void` to the props type and destructuring;
  - render `<Headsups onAction={openHeadsup} />` directly after `<FocusNote note={brief} />`.

Until Task 8 wires it, pass `openHeadsup={() => {}}` from `components/app-shell.tsx` so the app still typechecks.

- [ ] **Step 8: Verify** — `pnpm typecheck && pnpm lint && pnpm test` → all pass. Then `pnpm dev`, sign in, open Today: with no heads-ups the card is absent, and a `headsup_preferences` row now exists for you (check in Supabase). Insert a row by hand in the SQL editor to see the card:

```sql
insert into public.headsups (user_id, kind, dedupe_key, urgency, title, body, action, action_label, worded_by)
values ('<your user id>', 'money.logging_gap', 'manual-test', 'normal', 'Nothing logged for 5 days', 'Anything to catch up on?', '{"type":"open_spending_entry"}', 'Add a spend', 'rules');
```

- [ ] **Step 9: Commit**

```bash
git add lib/headsups/types.ts lib/headsups/repository.ts app/api/home/headsups/route.ts app/headsups/actions.ts components/today/headsups.tsx app/styles/headsups.css app/layout.tsx components/today/today-screen.tsx components/app-shell.tsx
git commit -m "Heads-ups: the Today card, its route and actions"
```

---

### Task 8: Prepared steps open the right screen

**Files:**
- Modify: `components/app-shell.tsx`, `components/money/money-screen.tsx`, `components/money/spending-screen.tsx`, `components/money/spending-summary.tsx`, `components/money/manual-transaction-form.tsx`, `components/health/health-screen.tsx`, `components/settings/settings-sheet.tsx`, `components/settings/routine-settings.tsx`

**Interfaces:**
- Consumes: `HeadsupAction` (types.ts), `TodayScreen`'s `openHeadsup` prop (Task 7).
- Produces: `MoneyScreen` and `SpendingScreen` prop `intent?: HeadsupAction | null`; `SpendingSummary` prop `highlight?: string | null`; `ManualTransactionForm` prop `initialCategory?: string`; `HealthScreen` prop `intent?: HeadsupAction | null`; `SettingsSheet` prop `editRoutineId?: string | null`; `RoutineSettings` prop `editId?: string | null`.

Screens read the intent only in their initial state, so it acts once, when the screen mounts from the tap. The shell clears it on any other navigation.

- [ ] **Step 1: App shell** — in `components/app-shell.tsx`:

```tsx
// with the other state
const [intent, setIntent] = useState<HeadsupAction | null>(null);

// beside openTarget
const openHeadsup = (action: HeadsupAction) => {
  setIntent(action);
  if (action.type === 'adjust_routine') return setSettings('day');
  setSettings(null);
  if (action.type === 'open_spending_entry' || action.type === 'review_category') {
    setMoney('spending');
    return setTab('money');
  }
  setTab('health');
};
```

- in `openTarget`, add `setIntent(null);` as its first line;
- in the bottom nav `onClick`, add `setIntent(null);`;
- pass `openHeadsup={openHeadsup}` to `TodayScreen` (replacing the Task 7 stub);
- pass `intent={intent}` to `MoneyScreen` and `HealthScreen`;
- pass `editRoutineId={intent?.type === 'adjust_routine' ? intent.routineId : null}` to `SettingsSheet`, and change its `onClose` to `() => { setSettings(null); setIntent(null); }`;
- add `intent` to the `useMemo` dependency list.

- [ ] **Step 2: Money** — `money-screen.tsx`: add `intent?: HeadsupAction | null` to the props and pass `intent={intent}` to `SpendingScreen`.

`spending-screen.tsx`:

```tsx
export function SpendingScreen({ summary, switcher, intent }: { summary: FinanceSummary; switcher?: ReactNode; intent?: HeadsupAction | null }) {
  const [view, setView] = useState<FinanceView>(() => intent?.type === 'open_spending_entry' ? 'add' : 'main');
  const prefill = intent?.type === 'open_spending_entry' ? intent.category : undefined;
  const highlight = intent?.type === 'review_category' ? intent.category : null;
```

- pass `initialCategory={prefill}` to `ManualTransactionForm`;
- pass `highlight={highlight}` to `SpendingSummary`.

`manual-transaction-form.tsx`: add `initialCategory?: string` to the props; `const [category, setCategory] = useState(() => initialCategory && (EXPENSE_CATEGORIES as readonly string[]).includes(initialCategory) ? initialCategory : '');`.

`spending-summary.tsx`:

```tsx
export function SpendingSummary({ month, highlight = null }: { month: Month; highlight?: string | null }) {
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center' }); }, []);
```

- Place this before the early `return` for `month.spent <= 0`, since hooks must run unconditionally. Import `useEffect` and `useRef` from `react`.
- Make the highlighted category always visible: `const shown = [...month.categories.slice(0, SHOWN_CATEGORIES), ...month.categories.slice(SHOWN_CATEGORIES).filter((item) => item.category === highlight)];` and `const rest = month.categories.slice(SHOWN_CATEGORIES).filter((item) => item.category !== highlight);`.
- On each row: `className={item.category === highlight ? 'fd-cat is-focus' : 'fd-cat'}` and `ref={item.category === highlight ? focusRef : undefined}`.
- Add to `app/styles/headsups.css`: `.fd-cat.is-focus { border-radius: 12px; outline: 2px solid color-mix(in srgb, var(--fd-ink) 18%, transparent); outline-offset: 4px; }`.

- [ ] **Step 3: Health** — `health-screen.tsx`: add `intent?: HeadsupAction | null` to the props, and change the view state to:

```tsx
const [view, setView] = useState<HealthView>(() => intent?.type === 'open_health_plan' ? { name: 'plans', planId: intent.planId } : { name: 'main' });
```

`open_steps` lands on main, where the steps card is first.

- [ ] **Step 4: Settings** — `settings-sheet.tsx`: add `editRoutineId?: string | null` to the props and pass `editId={editRoutineId}` to `RoutineSettings`. `routine-settings.tsx`: add `editId?: string | null` to the props, and derive the initial state from it. This must go before the early return that exists today:

```tsx
const target = editId ? summary.routines.find((routine) => routine.id === editId) : undefined;
const [draft, setDraft] = useState(() => target ? { title: target.title, kind: target.kind, atTime: target.atTime, days: target.days } : blank);
const [editing, setEditing] = useState<string | null>(target?.id ?? null);
const [open, setOpen] = useState(Boolean(target));
```

- [ ] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Then use the hand-inserted row from Task 7 in `pnpm dev`, once per action type, by updating its `action`:

| `action` | Expected |
|---|---|
| `{"type":"open_spending_entry","category":"Food"}` | Money → Spending, add form open, category Food |
| `{"type":"review_category","category":"<a category you have this month>"}` | Spending, that row outlined and scrolled into view |
| `{"type":"adjust_routine","routineId":"<a routine id>"}` | Settings → Your day, that routine open for editing |
| `{"type":"open_health_plan","planId":"<a plan id>"}` | Health → that plan |

After each tap, the heads-up is gone from Today on reload (status `done`). Reset the row with `update public.headsups set status = 'new' where dedupe_key = 'manual-test';`.

- [ ] **Step 6: Commit**

```bash
git add components/app-shell.tsx components/money/money-screen.tsx components/money/spending-screen.tsx components/money/spending-summary.tsx components/money/manual-transaction-form.tsx components/health/health-screen.tsx components/settings/settings-sheet.tsx components/settings/routine-settings.tsx app/styles/headsups.css
git commit -m "Heads-ups: each prepared step opens its screen ready to go"
```

---

### Task 9: Settings group and E2E

**Files:**
- Create: `components/settings/headsup-settings.tsx`, `tests/e2e/today/headsups.spec.ts`
- Modify: `components/settings/settings-sheet.tsx` (the `ai` group)

**Interfaces:**
- Consumes: `/api/home/headsups` (`HeadsupsResponse`), `setHeadsupKindAction`, `clearHeadsupsAction`, `HEADSUP_KINDS`, `KIND_LABELS`.
- Produces: `<HeadsupSettings />`.

- [ ] **Step 1: Write `components/settings/headsup-settings.tsx`**:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { clearHeadsupsAction, setHeadsupKindAction } from '@/app/headsups/actions';
import { safeAction } from '@/lib/client/safe-action';
import { HEADSUP_KINDS, KIND_LABELS, type HeadsupKind, type HeadsupsResponse } from '@/lib/headsups/types';

/** Which checks run, and a way to clear what they found. */
export function HeadsupSettings() {
  const [disabled, setDisabled] = useState<HeadsupKind[] | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void fetch('/api/home/headsups', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() as Promise<HeadsupsResponse> : null))
      .then((result) => { if (live) setDisabled(result?.state === 'ready' ? result.disabledKinds : []); })
      .catch(() => { if (live) setDisabled([]); });
    return () => { live = false; };
  }, []);

  function toggle(kind: HeadsupKind, enabled: boolean) {
    setDisabled((current) => (current ?? []).filter((item) => item !== kind).concat(enabled ? [] : [kind]));
    startTransition(async () => {
      const result = await safeAction(setHeadsupKindAction)(kind, enabled);
      setMessage({ text: result.message, success: result.success });
    });
  }

  return (
    <div className="pf-headsups">
      <p className="fd-note tight">Orbis checks these once a day and puts anything worth knowing on Today. The checks run inside Orbis; with AI on, only the numbers behind a heads-up are sent to be worded.</p>
      {HEADSUP_KINDS.map((kind) => (
        <label className="fd-line" key={kind}>
          <span>{KIND_LABELS[kind]}</span>
          <input type="checkbox" role="switch" checked={!(disabled ?? []).includes(kind)} disabled={disabled === null || isPending} onChange={(event) => toggle(kind, event.target.checked)} />
        </label>
      ))}
      <div className="fd-act">
        <button type="button" disabled={isPending} onClick={() => startTransition(async () => {
          const result = await safeAction(clearHeadsupsAction)();
          setMessage({ text: result.message, success: result.success });
        })}>Clear all heads-ups</button>
      </div>
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
```

Check how `components/settings/notification-settings.tsx` draws a switch row. If it uses a shared switch component or class, use that instead of the bare checkbox, so the switches match.

- [ ] **Step 2: Mount it** — in `settings-sheet.tsx`, inside `<Group id="ai" …>` after `<HomeBriefSetting … />`:

```tsx
<h3 className="fd-label">Heads-ups</h3>
<HeadsupSettings />
```

- [ ] **Step 3: Write the E2E test** `tests/e2e/today/headsups.spec.ts`. Read `tests/e2e/support/fixtures.ts` and `tests/e2e/finance/manual-expense.spec.ts` first, and follow their patterns:

```ts
import { expect, openApp, openSettings, test } from '../support/fixtures';

const HEADSUP = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'money.logging_gap',
  urgency: 'normal',
  title: 'Nothing logged for 5 days',
  body: 'You usually add spending most days.',
  action: { type: 'open_spending_entry', category: 'Food' },
  actionLabel: 'Add a spend',
  wordedBy: 'rules',
  createdAt: '2026-09-30T00:30:00Z',
};

test('a heads-up shows on Today and its step opens a prefilled spending form', async ({ page }) => {
  await page.route('**/api/home/headsups', (route) => route.fulfill({ json: { state: 'ready', headsups: [HEADSUP], disabledKinds: [], offerOff: [] } }));
  await openApp(page);
  const card = page.getByRole('region', { name: 'Heads-ups' });
  await expect(card.getByText('Nothing logged for 5 days')).toBeVisible();
  await expect(card.getByText('From your spending · worded by Orbis')).toBeVisible();
  await card.getByRole('button', { name: 'Add a spend' }).click();
  await expect(page.getByRole('combobox', { name: /category/i })).toHaveValue('Food');
});

test('Settings lists the heads-up checks', async ({ page }) => {
  await page.route('**/api/home/headsups', (route) => route.fulfill({ json: { state: 'ready', headsups: [], disabledKinds: ['money.logging_gap'], offerOff: [] } }));
  await openApp(page);
  await openSettings(page);
  await expect(page.getByRole('switch', { name: 'Days with no spending logged' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'A spend much bigger than usual' })).toBeChecked();
});
```

The completion action will fail against the fake id. That is expected and not asserted. If the category control in `manual-transaction-form.tsx` is not a labelled `<select>`, change the last assertion to whatever locator `manual-expense.spec.ts` uses for it.

- [ ] **Step 4: Run it**

Run: `pnpm test:e2e tests/e2e/today/headsups.spec.ts`
Expected: 2 passed. The suite needs the E2E test account environment (see `tests/e2e/support/env.ts`). If that is not configured on this machine, record that the E2E test was written but not run.

- [ ] **Step 5: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/settings/headsup-settings.tsx components/settings/settings-sheet.tsx tests/e2e/today/headsups.spec.ts
git commit -m "Heads-ups: Settings switches and an end-to-end test"
```

---

## After the tasks

- Update `README.md` (AI router bullet: mention heads-ups) and `BUILD_ROADMAP.md` (add a checked "Proactive heads-ups: Money, Routines & health" item and an open "Phase 2: Mail, Investments" item). Commit as "Document heads-ups".
- The owner applies the migration before deploying and the cron SQL after (Task 1, Step 6).
