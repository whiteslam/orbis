# Phase 0: Multi-user Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing web app safe and fair for strangers: open, rate-limited sign-up with Google; roles instead of email lists; each person's own time zone, currency and locale; first-run onboarding; per-plan AI limits; a reviewed service-role surface; error reporting; and multi-user legal text.

**Architecture:**
- **Settings:** a new per-person `user_settings` row holds time zone, currency, locale, chosen modules and onboarding state.
- **Shared helpers:** pure helpers in `lib/locale/` replace every hard-coded `Asia/Kolkata`, `+05:30`, `330 * 60` and `en-IN`. Server code reads the person's settings; client components read them from a React context set by the signed-in page.
- **Roles and plans:** new tables `account_roles`, `plans` and `account_plans`. Only the service role writes them, and each person can read their own rows.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before writing Next code), React 19, Supabase (Postgres, Auth, RLS), Vitest (`lib/**/*.test.ts`, `node:assert/strict` style as in `lib/notifications/schedule.test.ts`), Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-12-android-agent-design.md` §7 Phase 0 (and §2–§4, §9).

## Global Constraints

- Work in `f:\Orbis\orbis-android` on branch `android-agent`. Push the branch, never `main`.
- Migrations live in `supabase/migrations/`, named `20261112NNNN_<name>.sql`. Each must be safe to run more than once (`if not exists`, `drop policy if exists`, `create or replace`).
- Every new user-owned table has RLS keyed on `(select auth.uid()) = user_id`, plus explicit grants (pattern: `202609240015_profile_journal_notifications.sql`). `account_roles`, `plans` and `account_plans` get **select-own only**; writes come from the service role or SQL.
- **India-first defaults:** time zone `Asia/Kolkata`, currency `INR`, locale `en-IN`. These are exported once as `DEFAULT_PERSON_LOCALE` from `lib/locale/person.ts`. Anyone without a `user_settings` row behaves exactly as today.
- **Server actions** return `{ success: boolean; message: string; … }`. User-facing copy is plain and short, in the voice already in `app/auth/actions.ts`.
- **Allowed `Asia/Kolkata` uses** that stay hard-coded:
  - `lib/providers/markets.ts`: NSE hours are Indian time by definition.
  - `lib/ai/policy.ts`: the operator's budget month.
  - Examples in `lib/career/spec.ts`, `lib/career/mail.ts` and `lib/career/render/fixtures.ts`.
  - Test files.
- Before each commit: `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A time zone where "today" differs from India's** (America/Los_Angeles at 20:00 local, already the next day in IST). The journal date, routines "today", spending "this month" and heads-ups must use the person's date. Pinned in Task 2 and Task 4.
2. **Daylight-saving zones** (Europe/London across the last Sunday of March). Month-start and `zonedIso` must produce the right offset on both sides. Pinned in Task 2.
3. **An invalid or empty stored time zone or currency** (e.g. `"Mars/Base"`, `"XYZ"`). Fall back to the default rather than letting `Intl` throw and take down the page. Pinned in Task 1.
4. **Google sign-in by a brand-new person while sign-ups are closed.** They must not get in. Pinned in Task 6.
5. **An existing account (the owner) after the migrations.** No onboarding screen, no tabs hidden, the same AI limits as today, the Research desk still visible once the owner role is granted. Pinned in Task 1 (backfill), Task 7 and Task 8.

---

### Task 1: Person settings: table, types, repository

**Files:**
- Create: `supabase/migrations/202611120001_user_settings.sql`
- Create: `lib/locale/person.ts`, `lib/locale/person.test.ts`
- Create: `lib/locale/repository.ts`
- Modify: `lib/account/deletion-plan.ts` (add `user_settings` to the export list and `SINGLE_ROW_TABLES`)

**Interfaces:**
- Produces:
  - `type PersonLocale = { timeZone: string; currency: string; locale: string }`
  - `DEFAULT_PERSON_LOCALE: PersonLocale` (`Asia/Kolkata`, `INR`, `en-IN`)
  - `type ModuleId = 'money' | 'health' | 'journal' | 'social' | 'career'`; `ALL_MODULES: ModuleId[]`
  - `type PersonSettings = PersonLocale & { modules: ModuleId[]; onboardedAt: string | null }`
  - `normalizeSettings(row: Record<string, unknown> | null): PersonSettings`: pure; invalid or missing values fall back to defaults; a missing row means `onboardedAt: null`
  - `isValidTimeZone(value: string): boolean`, `isValidCurrency(value: string): boolean`, `isValidLocale(value: string): boolean`
  - `getPersonSettings(userId: string): Promise<PersonSettings>`: server-only, wrapped in React `cache`; a missing table or row returns the defaults
  - `getPersonSettingsAdmin(admin, userId): Promise<PersonSettings>`: for crons running with the service role

- [ ] **Step 1: Write the migration.**
  - Table `public.user_settings`:
    - `user_id uuid pk references auth.users on delete cascade`
    - `timezone text not null default 'Asia/Kolkata'` (length 1–64)
    - `currency text not null default 'INR'` (`^[A-Z]{3}$`)
    - `locale text not null default 'en-IN'` (length 2–35)
    - `modules text[] not null default '{money,health,journal,social,career}'`
    - `onboarded_at timestamptz`
    - `created_at`, `updated_at` with the `set_updated_at` trigger
  - RLS for-all-own, and grants `select, insert, update` to `authenticated`.
  - **Backfill:** insert one row for every existing `auth.users` id, with `onboarded_at = now()`. The time zone comes from `notification_preferences.timezone` when present. Use `on conflict do nothing`.
- [ ] **Step 2: Write the failing tests** in `lib/locale/person.test.ts`:
  - `normalizeSettings(null)` deep-equals `{ ...DEFAULT_PERSON_LOCALE, modules: ALL_MODULES, onboardedAt: null }`.
  - `normalizeSettings({ timezone: 'Mars/Base', currency: 'XYZ1', locale: '', modules: ['money', 'bogus'], onboarded_at: '2026-11-12T00:00:00Z' })` gives `timeZone: 'Asia/Kolkata'`, `currency: 'INR'`, `locale: 'en-IN'`, `modules: ['money']`, and `onboardedAt` kept.
  - `isValidTimeZone('America/Los_Angeles') === true`, `isValidTimeZone('Mars/Base') === false`.
  - `isValidCurrency('USD') === true`, `isValidCurrency('usd') === false`.
- [ ] **Step 3: Run** `pnpm vitest run lib/locale/person.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `lib/locale/person.ts`.**
  - Validate a time zone with `new Intl.DateTimeFormat('en', { timeZone })` inside try/catch.
  - Validate a currency with the regex plus `Intl.NumberFormat` with `style: 'currency'` in try/catch.
  - Validate a locale with `Intl.getCanonicalLocales` in try/catch.
- [ ] **Step 5: Implement `lib/locale/repository.ts`** (`import 'server-only'`) using `createClient()` / `isMissingTable` as in `lib/personal/repository.ts`.
- [ ] **Step 6: Run** `pnpm vitest run lib/locale` → PASS. Then run `pnpm typecheck`.
- [ ] **Step 7: Commit:** "Add per-person settings: time zone, currency, locale, modules".

### Task 2: Shared date and money helpers

**Files:**
- Create: `lib/locale/dates.ts`, `lib/locale/dates.test.ts`, `lib/locale/money.ts`, `lib/locale/money.test.ts`

**Interfaces:**
- Consumes: `PersonLocale`, `DEFAULT_PERSON_LOCALE` (Task 1).
- Produces (all pure):
  - `localDate(at: Date | string, timeZone: string): string`. Returns `YYYY-MM-DD`.
  - `localParts(at: Date | string, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number }`. `weekday` is 0 for Monday.
  - `zoneOffset(at: Date, timeZone: string): string`. Returns e.g. `+05:30`, `-07:00`, `Z` for UTC.
  - `zonedIso(date: string, time: string, timeZone: string): string`. Takes a local wall time and returns ISO with the correct offset for that day.
  - `monthStartUtc(year: number, month: number, timeZone: string): string`. The UTC ISO instant of local midnight on the 1st.
  - `formatWhen(at: Date | string, loc: PersonLocale, preset: 'day' | 'dayLong' | 'time' | 'dayTime' | 'medium' | 'weekday'): string`
    - `day` → "12 Nov"
    - `dayLong` → "Thursday, 12 November"
    - `time` → "3:05 pm"
    - `dayTime` → "12 Nov, 3:05 pm"
    - `medium` → dateStyle medium
    - `weekday` → "Thursday"
  - `formatMoney(amount: number, currency: string, locale: string, opts?: { compact?: boolean; decimals?: 'auto' | 0 }): string`. Follows today's `lib/finance/money.ts` rules: `auto` means 0 decimals at ≥1000 or when compact, otherwise 2. An invalid currency falls back to `"${currency} ${amount}"`.

- [ ] **Step 1: Write the failing tests**:
  - `localDate('2026-11-12T04:00:00Z', 'America/Los_Angeles') === '2026-11-11'` and `localDate('2026-11-12T04:00:00Z', 'Asia/Kolkata') === '2026-11-12'`.
  - `zonedIso('2026-03-28', '12:00', 'Europe/London') === '2026-03-28T12:00:00Z'` (GMT, `Z` form), `zonedIso('2026-03-30', '12:00', 'Europe/London') === '2026-03-30T12:00:00+01:00'`, and `zonedIso('2026-11-12', '09:30', 'Asia/Kolkata') === '2026-11-12T09:30:00+05:30'`.
  - `monthStartUtc(2026, 11, 'Asia/Kolkata') === '2026-10-31T18:30:00.000Z'` and `monthStartUtc(2026, 4, 'Europe/London') === '2026-03-31T23:00:00.000Z'`.
  - `formatMoney(1234.5, 'INR', 'en-IN') === '₹1,235'`, `formatMoney(12.5, 'USD', 'en-US') === '$12.50'`, `formatMoney(5, 'XYZ1', 'en-IN') === 'XYZ1 5'`.
  - `formatWhen('2026-11-12T09:35:00Z', DEFAULT_PERSON_LOCALE, 'day') === '12 Nov'`.
- [ ] **Step 2: Run** `pnpm vitest run lib/locale` → FAIL.
- [ ] **Step 3: Implement.**
  - Everything goes through `Intl.DateTimeFormat#formatToParts` with `hourCycle: 'h23'`.
  - `zoneOffset` compares the zone's wall clock to UTC for the instant.
  - `zonedIso` makes a first guess from the offset at the UTC-noon of that date, then corrects once.
- [ ] **Step 4: Run** `pnpm vitest run lib/locale` → PASS.
- [ ] **Step 5: Commit:** "Add zone-aware date and money helpers".

### Task 3: Person settings reach the client

**Files:**
- Create: `components/locale/person-locale.tsx`
- Modify: `app/(orbis)/active/page.tsx` (load `getPersonSettings(userId)` in the existing `Promise.all`, wrap `AppShell` in the provider)
- Modify: `components/app-shell.tsx` only if it needs the settings as a prop (prefer the hook)

**Interfaces:**
- Consumes: `PersonSettings` (Task 1).
- Produces:
  - `'use client'`: `PersonSettingsProvider({ value: PersonSettings, children })`
  - `usePersonLocale(): PersonLocale`, `usePersonSettings(): PersonSettings`. Outside a provider both return the defaults.

- [ ] **Step 1: Implement the provider and hooks** with `createContext`. The default value is built from `DEFAULT_PERSON_LOCALE` and `ALL_MODULES`, with `onboardedAt: null`.
- [ ] **Step 2: Wire `active/page.tsx`.**
  - Await `getPersonSettings(userId)` right after the gate opens, before the existing `Promise.all`. `listMonth` needs the period, and the read is one small row.
  - Replace `periodOfDate(indiaToday())` with `periodOfDate(localDate(new Date(), settings.timeZone))`.
- [ ] **Step 3: Verify.** `pnpm typecheck && pnpm build` pass. Then `pnpm dev`, sign in, and Today renders unchanged.
- [ ] **Step 4: Commit:** "Hand each person's settings to the app shell".

### Task 4: Replace hard-coded India time and money (server and lib)

**Files (modify):**
- `lib/ask/select.ts`: `istDate(iso)` becomes `localDate(iso, tz)`. `buildAskContext` in `lib/ask/context.ts` reads `getPersonSettings`. Rename callers.
- `lib/journal/repository.ts`, `app/personal/journal-actions.ts`, `app/personal/voice-actions.ts`: "today" uses the person's zone.
- `lib/routines/today.ts`, `lib/focus/types.ts`:
  - `istParts` becomes `localParts`.
  - `money` re-exports `formatMoney`; keep the export name `money(amount, currency?)` for callers, defaulting to `DEFAULT_PERSON_LOCALE`.
- `lib/finance/repository.ts`, `lib/finance/breakdown.ts`, `lib/finance/money.ts`:
  - Month bounds go through `monthStartUtc`.
  - `money()` delegates to `formatMoney`.
- `lib/home/note.ts`, `lib/home/ai-brief.ts`, `lib/home/training.ts`, `lib/focus/career.ts`, `lib/history/describe.ts`, `lib/health-docs/format.ts`, `lib/workbook/shown-advice.ts`, `lib/social/month.ts` (`indiaToday` becomes `todayIn(timeZone)`).
- `lib/career/scoring.ts`, `lib/career/insights-data.ts`, `app/career/actions.ts`, `lib/career/send.ts` (`IST_OFFSET` becomes `zoneOffset`).
- **Crons, which already loop over users:**
  - `lib/headsups/scan.ts`, `lib/headsups/plan.ts`, `lib/career/watch.ts`, `lib/research/queue.ts`: each user's zone via `getPersonSettingsAdmin`.
  - `lib/notifications/preferences.ts` and `lib/notifications/repository.ts`: fall back to the person's `user_settings.timezone` instead of `'Asia/Kolkata'`.
  - `lib/notifications/schedule.ts` already takes `timezone`; replace only its `'Asia/Kolkata'` fallback.

**Interfaces:**
- Consumes: Task 1 (`getPersonSettings`, `getPersonSettingsAdmin`) and Task 2 helpers.
- Produces: `todayIn(timeZone: string): string` in `lib/social/month.ts`. Functions that computed in IST take a `timeZone: string` parameter (no default) so the compiler finds every caller.

- [ ] **Step 1: Write the failing tests** next to the existing ones:
  - `lib/headsups/plan.test.ts`: a plan built with `timeZone: 'America/Los_Angeles'` at `2026-11-12T04:00:00Z` treats the local date as `2026-11-11`.
  - `lib/notifications/schedule.test.ts`: `dueSlots` with a Los Angeles timezone sends the morning slot at 06:30 Los Angeles time (`2026-11-12T14:30:00Z`).
  - New `lib/finance/breakdown.test.ts` case: a transaction at `2026-11-01T02:00:00Z` counts as 31 Oct for `America/New_York` and as 1 Nov for `Asia/Kolkata`.
- [ ] **Step 2: Run** `pnpm vitest run lib/headsups lib/notifications lib/finance` → FAIL.
- [ ] **Step 3: Make the changes listed above.** Remove the module-level `TIME_ZONE`/`INDIA`/`IST_OFFSET*` constants. Thread `timeZone` through as a parameter.
- [ ] **Step 4: Verify.**
  - `pnpm typecheck && pnpm test` → PASS.
  - `grep -rn "Asia/Kolkata\|+05:30\|330 \* 60" lib app --include=*.ts --include=*.tsx | grep -v test` lists only the allowed uses in Global Constraints.
- [ ] **Step 5: Commit:** "Use each person's time zone on the server instead of India time".

### Task 5: Replace hard-coded India time and money (components)

**Files (modify):** every component listed by `grep -rln "Asia/Kolkata\|'en-IN'" components`:
- `components/career/format.ts`, `career/panel/interviews-page.tsx`, `career/panel/panel-data.ts`, `career/panel/title-row.tsx`
- `field/field.tsx`
- `health/health-screen.tsx`, `health/plan-builder.tsx`
- `journal/context-notes.tsx`, `journal/journal.tsx`
- `money/broker-card.tsx`, `money/manual-transaction-form.tsx` (`+05:30` becomes `zonedIso`), `money/portfolio-ai.tsx`, `money/spending-screen.tsx`, `money/spending-summary.tsx`, `money/transaction-list.tsx`
- `settings/app-integrations.tsx`, `settings/integrations.tsx`, `settings/routine-settings.tsx`
- `shell/desktop-header.tsx`
- `social/post-drawer.tsx`, `social/social-insights.tsx`
- `today/important-mail.tsx`, `today/news-card.tsx`, `today/today-screen.tsx`, `today/today-widgets.tsx`
- Plus the files that call `money(`/`toLocaleString('en-IN')` for amounts.

Leave `components/career/setup/setup-spec.tsx`'s placeholder text alone.

**Interfaces:**
- Consumes: `usePersonLocale()` (Task 3), `formatWhen`, `localDate`, `localParts`, `zonedIso` and `formatMoney` (Task 2).
- Produces: nothing new. A new manual transaction defaults to the person's `currency`.

- [ ] **Step 1: In each component**, read `const loc = usePersonLocale()` and replace the inline `Intl`/`toLocale*` call with the matching `formatWhen` preset or `localDate`/`localParts`. Module-level formatters (e.g. `social-insights.tsx`'s `DAY`) move inside the component or become functions that take `loc`.
- [ ] **Step 2: Add a Playwright check** in `tests/e2e/forms/crud.spec.ts` or a new `tests/e2e/locale/time-zone.spec.ts`:
  - Set the signed-in test user's `user_settings.timezone` to `America/Los_Angeles` through the admin client.
  - Save a journal entry.
  - Assert the entry's date matches `localDate(new Date(), 'America/Los_Angeles')`.
- [ ] **Step 3: Verify.**
  - `grep -rn "Asia/Kolkata" components | grep -v setup-spec` prints nothing.
  - `pnpm typecheck && pnpm lint && pnpm build` → PASS.
  - Run the new spec against the **staging** Supabase only (see Task 11), never production.
- [ ] **Step 4: Commit:** "Show every date and amount in the person's own zone and currency".

### Task 6: Open, rate-limited sign-up and Google sign-in

**Files:**
- Modify: `lib/security/rate-limit-rules.ts`. Add `'signup'` to `AnonRateBucket`: `{ perAddress: { limit: 5, windowSeconds: 3_600 }, global: { limit: 200, windowSeconds: 3_600 } }`.
- Modify: `app/auth/actions.ts`:
  - `signUp` checks `anonRateLimitAllows(anonRateKey(clientIpFrom(await headers())), 'signup')` after `signupsOpen()`. When refused it returns `{ error: 'Too many new accounts from here. Try again in an hour.', message: null }`.
  - Add `signInWithGoogle()`.
- Modify: `lib/security/unlock-token.ts`. Add `oauth: ['oauth']` to `UNLOCK_METHODS`.
- Modify: `app/auth/callback/route.ts`. Add the new-account check and the oauth unlock.
- Modify: `components/auth/auth-form.tsx` and `app/(orbis)/login/page.tsx` to add the "Continue with Google" button, shown only when `googleSignInEnabled()`.
- Modify: `lib/security/access.ts`. Add `googleSignInEnabled(): boolean` (env `ORBIS_GOOGLE_SIGNIN === 'true'`).
- Modify: `.env.example`. Document `ORBIS_GOOGLE_SIGNIN` and `ORBIS_OPEN_SIGNUPS`.
- Test: `lib/security/access.test.ts`, `lib/security/rate-limit-rules.test.ts`, and a new `lib/security/new-account.test.ts`.

**Interfaces:**
- Produces:
  - `signInWithGoogle(): Promise<AuthActionState>`. It redirects to `data.url` from `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: \`${siteUrl()}/auth/callback?next=/active\` } })`. When `!googleSignInEnabled()` it returns an error state.
  - `isBrandNewAccount(createdAt: string | undefined, lastSignInAt: string | undefined, now: Date): boolean`, pure, in `lib/security/new-account.ts`. True when `createdAt` is within 120 s of `now` and `lastSignInAt` is within 5 s of `createdAt`.

- [ ] **Step 1: Write the failing tests.**
  - `isBrandNewAccount('2026-11-12T10:00:00Z', '2026-11-12T10:00:01Z', new Date('2026-11-12T10:00:30Z')) === true`.
  - The same with `now` at 10:05 → `false`.
  - `anonLimitsFor('signup')` deep-equals the limits above.
  - `googleSignInEnabled()` is false unless the env var is `'true'`.
- [ ] **Step 2: Run** `pnpm vitest run lib/security` → FAIL.
- [ ] **Step 3: Implement.** In the callback, after the `accessAllowed` check:
  - If `!signupsOpen()` and `isBrandNewAccount(user.created_at, user.last_sign_in_at, new Date())`, then delete that user with the admin client (`auth.admin.deleteUser`), sign out, and redirect to `/login?error=private`.
  - Unlock with `UNLOCK_METHODS.oauth` when the session came from OAuth, otherwise `emailLink`.
- [ ] **Step 4: Verify.** `pnpm vitest run lib/security && pnpm typecheck && pnpm build` → PASS.
- [ ] **Step 5: Commit:** "Rate-limit sign-up and add Google sign-in behind a switch".

**Owner action noted in the hand-off:** enable the Google provider in Supabase Auth with the Google Cloud OAuth client from the Firebase/Google Cloud project, add the callback URL, then set `ORBIS_GOOGLE_SIGNIN=true` and, when ready, `ORBIS_OPEN_SIGNUPS=true`.

### Task 7: Roles instead of email lists

**Files:**
- Create: `supabase/migrations/202611120002_account_roles.sql`
- Create: `lib/security/roles.ts`, `lib/security/roles.test.ts`
- Modify: `lib/research/access.ts` and its callers (`grep -rn "researchDeskAvailable\|researchDeskAllowed" app lib components`)
- Modify: `lib/account/deletion-plan.ts` (export includes the person's role)

**Interfaces:**
- Produces:
  - `type Role = 'owner' | 'admin' | 'user'`
  - `parseRole(value: unknown): Role` (unknown values become `'user'`)
  - `getRole(userId: string): Promise<Role>`: server-only, React `cache`, through the person's own RLS session; a missing table returns `'user'`
  - `getRoleAdmin(admin, userId): Promise<Role>`
  - `researchDeskAllowed(role: Role, email: string | null | undefined): boolean`: true for `'owner'`, or while `ORBIS_RESEARCH_DESK_EMAILS` lists the email (kept as a fallback)
  - `researchDeskAvailable(role, email, workerConfigured)`

- [ ] **Step 1: Write the migration.**
  - `public.account_roles`: `user_id uuid pk references auth.users on delete cascade`, `role text not null check (role in ('owner','admin','user'))`, `granted_at timestamptz not null default now()`.
  - RLS: select own. Grant `select` to `authenticated`, no write grant.
  - A comment block with the owner's one-line SQL: `insert into public.account_roles (user_id, role) select id, 'owner' from auth.users where email = '<owner email>' on conflict (user_id) do update set role = excluded.role;`
- [ ] **Step 2: Write the failing tests.**
  - `parseRole('owner') === 'owner'` and `parseRole('root') === 'user'`.
  - `researchDeskAllowed('owner', null) === true`.
  - `researchDeskAllowed('user', 'x@y.z') === false` with an empty env list.
  - `researchDeskAllowed('user', 'x@y.z') === true` when `ORBIS_RESEARCH_DESK_EMAILS='x@y.z'`.
- [ ] **Step 3: Run** `pnpm vitest run lib/security/roles.test.ts` → FAIL. **Implement**, update the callers to pass `await getRole(userId)`, then run → PASS. Then `pnpm typecheck`.
- [ ] **Step 4: Commit:** "Add owner/admin/user roles; the Research desk follows the owner role".

### Task 8: Per-plan AI limits

**Files:**
- Create: `supabase/migrations/202611120003_plans.sql`
- Create: `lib/ai/limits.ts`, `lib/ai/limits.test.ts`
- Modify:
  - `lib/ai/quota.ts`: add `'ask_orbis'` to `AiQuotaFeature`, for typing only. Ask keeps its own RPC.
  - The call sites: `lib/ask/answer.ts` (`DAILY_ASK_LIMIT`), `lib/career/ai.ts` (`CAREER_AI[feature].daily`), `lib/home/brief-service.ts` (`DAILY_BRIEF_LIMIT`), `lib/news/portfolio.ts` (`DAILY_LIMIT`), `app/health/actions.ts` (`DAILY_ADVICE_LIMIT`), `app/health/library-actions.ts` and `app/invest/ai-actions.ts` (`DAILY_AI_LIMIT`).

**Interfaces:**
- Produces:
  - `type PlanLimits = Partial<Record<AiQuotaFeature, number>>`
  - `FALLBACK_LIMITS: Record<AiQuotaFeature, number>`: today's constants, collected from the call sites above, so behaviour is unchanged when no plan exists
  - `limitFor(feature: AiQuotaFeature, plan: PlanLimits | null): number`: pure; the plan's value if it's a positive integer, else the fallback
  - `dailyLimit(admin, userId: string, feature: AiQuotaFeature): Promise<number>`: reads `account_plans` joined to `plans.limits` (default plan `'free'`); any error gives the fallback

- [ ] **Step 1: Write the migration.**
  - `public.plans`: `id text pk`, `name text`, `limits jsonb not null default '{}'`.
  - `public.account_plans`: `user_id pk references auth.users on delete cascade`, `plan_id text not null references plans default 'free'`, `updated_at`.
  - Seed `('free','Free','{}')` and `('owner','Owner', <every feature at 10× its fallback>)` with `on conflict (id) do nothing`.
  - RLS: `account_plans` select own; `plans` select for `authenticated`. No write grants.
- [ ] **Step 2: Write the failing tests.**
  - `limitFor('home_brief', null) === FALLBACK_LIMITS.home_brief`.
  - `limitFor('home_brief', { home_brief: 40 }) === 40`.
  - `limitFor('home_brief', { home_brief: -1 }) === FALLBACK_LIMITS.home_brief`.
  - `limitFor('home_brief', { home_brief: 2.5 }) === FALLBACK_LIMITS.home_brief`.
- [ ] **Step 3: Run** → FAIL. **Implement.** Replace each constant at the call sites with `await dailyLimit(admin, userId, '<feature>')`. Run `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 4: Commit:** "Read daily AI limits from the person's plan".

### Task 9: Onboarding and module choice

**Files:**
- Create: `app/onboarding/actions.ts` (`'use server'`)
- Create: `components/onboarding/onboarding.tsx`
- Create: `lib/shell/modules.ts`, `lib/shell/modules.test.ts`
- Modify: `app/(orbis)/active/page.tsx`. When `settings.onboardedAt === null`, render `<Onboarding …/>` inside `AppLockGuard` instead of `AppShell`.
- Modify: the tab bar and desktop rail (`components/app-shell.tsx`, `components/shell/desktop-rail.tsx`) so they only show visible tabs.
- Modify: `components/settings/profile-editor.tsx` (the "You" section). Add time zone, currency and module controls that save through `saveSettings`.

**Interfaces:**
- Consumes: `PersonSettings`, `ModuleId`, `isValid*` (Task 1); `TabId`, `TABS` (`lib/shell/tabs.ts`).
- Produces:
  - `visibleTabs(modules: ModuleId[]): TabId[]`. `'today'` is always first; the other tab ids map 1:1 to modules.
  - `saveSettings(input: { timeZone: string; currency: string; locale: string; modules: ModuleId[] }): Promise<{ success: boolean; message: string }>`. It validates with `isValid*`, upserts `user_settings`, and returns `{ success: false, message: 'Pick a valid time zone.' }` (and the same for currency) on bad input.
  - `completeOnboarding(input: { preferredName: string; timeZone: string; currency: string; modules: ModuleId[]; aiEnabled: boolean }): Promise<{ success: boolean; message: string }>`. It saves the name through the existing profile path, saves settings, sets AI consent through the existing `lib/ai/consent-store.ts` path, and sets `onboarded_at = now()`.

- [ ] **Step 1: Write the failing tests:**
  - `visibleTabs(['money','journal'])` deep-equals `['today','money','journal']`.
  - `visibleTabs([])` deep-equals `['today']`.
  - `visibleTabs(ALL_MODULES)` deep-equals `TABS.map(t => t.id)`.
- [ ] **Step 2: Run** → FAIL. **Implement `modules.ts`.** Run → PASS.
- [ ] **Step 3: Build the onboarding screen.** One screen, four short steps:
  1. **Name.**
  2. **Time zone and currency.** Prefill the zone from `Intl.DateTimeFormat().resolvedOptions().timeZone` in the browser, and use `INR` when that zone is `Asia/Kolkata`, else `USD`.
  3. **Modules.** Checkboxes, all ticked.
  4. **AI on/off,** with the same wording as `components/settings/ai-consent.tsx`.

  The last step offers "Set a PIN" by opening the existing Security settings after finishing. It uses the existing Field and button styles on the glow background (memory: keep the wallpaper).
- [ ] **Step 4: Add a Playwright spec** `tests/e2e/onboarding/first-run.spec.ts`:
  - A new test user with no `user_settings` row sees onboarding.
  - They untick Social and finish.
  - Today shows, and the Social tab is absent.
  - Run it against staging only.
- [ ] **Step 5: Verify.** `pnpm typecheck && pnpm lint && pnpm build` → PASS. The owner account (backfilled `onboarded_at`) goes straight to Today.
- [ ] **Step 6: Commit:** "First-run onboarding and per-person modules".

### Task 10: Service-role review and guard

**Files:**
- Create: `docs/security/service-role-uses.md`
- Create: `lib/security/admin-usage.test.ts`
- Modify: any file the review finds unjustified

**Interfaces:**
- Produces: `ADMIN_CLIENT_ALLOWLIST: readonly string[]` exported from `lib/security/admin-usage.test.ts` (test-local). These are the repo-relative paths allowed to import `@/lib/supabase/admin`.

- [ ] **Step 1: List every file importing `createAdminClient`** (about 50: `grep -rln "createAdminClient" lib app workers --include=*.ts --include=*.tsx | grep -v test`). For each one, write a row in `service-role-uses.md`: file, why the service role is needed, whose data it touches, and whether it reads user **content** (journal, mail, transactions) or only counters, tokens or metadata.
- [ ] **Step 2:** For any use that reads user content outside that person's own job (a cron acting for them, or their own request), switch it to the person's RLS session (`createClient()`). If that can't be done, mark it "needs owner decision" in the doc.
- [ ] **Step 3: Write `admin-usage.test.ts`.** It scans `lib/` and `app/` with `node:fs`, collects files importing `@/lib/supabase/admin`, and asserts the set equals `ADMIN_CLIENT_ALLOWLIST`, so a new use fails CI until someone reviews it.
- [ ] **Step 4: Run** `pnpm vitest run lib/security/admin-usage.test.ts` → PASS.
- [ ] **Step 5: Commit:** "Review every service-role use and guard new ones".

### Task 11: Staging, migrations workflow and error reporting

**Files:**
- Create: `docs/ops/staging.md`. Covers creating the staging Supabase project; applying migrations in order with the Supabase CLI (`supabase link`, `supabase db push --include-all`); pointing `.env.test.local` at staging; and why e2e must never run against production.
- Modify: `playwright.config.ts`. Refuse to run when `NEXT_PUBLIC_SUPABASE_URL` equals `ORBIS_PRODUCTION_SUPABASE_URL` (when that env var is set).
- Sentry:
  - Add `@sentry/nextjs` only after checking its docs and peer dependencies support `next@16.3`. If not, skip this item and say so in the hand-off.
  - Create `instrumentation.ts` / `instrumentation-client.ts` per the Next 16 docs in `node_modules/next/dist/docs/`, enabled only when `SENTRY_DSN` is set.
  - Settings: `sendDefaultPii: false`, `tracesSampleRate: 0.1`, and a `beforeSend` that strips request bodies, cookies and query strings.
  - Update the CSP in `lib/security/csp.ts` for the Sentry ingest host.
- Modify: `.env.example` (`SENTRY_DSN`, `ORBIS_PRODUCTION_SUPABASE_URL`).

- [ ] **Step 1: Write the guard** in `playwright.config.ts`. Verify: with the two URLs equal, `pnpm test:e2e --list` exits with the message "Refusing to run e2e against production Supabase".
- [ ] **Step 2: Add Sentry** as above. Verify: `pnpm build` passes with and without `SENTRY_DSN`.
- [ ] **Step 3: Write `docs/ops/staging.md`.**
- [ ] **Step 4: Commit:** "Staging guide, production guard for e2e, opt-in Sentry".

### Task 12: Multi-user privacy policy and terms (DPDP)

**Files:**
- Modify: `app/privacy/page.tsx`, `app/terms/page.tsx`

- [ ] **Step 1: Rewrite both pages for many users in India**, under India's Digital Personal Data Protection Act. Cover:
  - what is collected per module
  - that each person's data is visible only to them (RLS)
  - which AI providers receive what, and that phone-derived data goes only to providers that don't train on it
  - retention
  - export and deletion (the existing `/delete-account`)
  - the grievance contact (`NEXT_PUBLIC_SUPPORT_EMAIL`)
  - a short "coming with the Android app" paragraph: nothing on the phone is read until the person turns it on

  Mark the page header "Draft: pending owner review".
- [ ] **Step 2: Verify.** `pnpm test:public` → PASS (the public pages still render, links resolve).
- [ ] **Step 3: Commit:** "Privacy policy and terms for many users (draft for owner review)".

### Task 13: Finish the phase

- [ ] **Step 1: Verify everything.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all PASS.
- [ ] **Step 2: Update the docs.** In `README.md`, describe the settings, roles and plans, and list the new migrations `202611120001`–`202611120003` with their apply order (in filename order, any time before deploy; all additive).
- [ ] **Step 3: Push** `git push origin android-agent`. Do not merge.
- [ ] **Step 4: Hand-off.** Report to the owner the actions only they can do:
  - Apply the migrations.
  - Grant the owner role.
  - Enable the Google provider and set `ORBIS_GOOGLE_SIGNIN`.
  - Create the staging project and Sentry DSN.
  - Review the legal text.
  - Set `ORBIS_OPEN_SIGNUPS=true` when ready.
