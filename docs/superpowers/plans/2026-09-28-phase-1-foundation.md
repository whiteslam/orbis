# Phase 1: Foundation — Safe, Fast and Honest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Orbis safe to open to strangers and noticeably faster:
- fix every audit finding that can be fixed in code without new external accounts
- add the public pages and account controls both app stores require

**Architecture:** Changes stay inside the existing single-page App Router app. Structural rework (route segments, onboarding, native wrappers) is Phase 2. Security moves into the right layers:
- **Proxy:** a nonce-based CSP.
- **Database:** CHECK constraints, grants and a rate-limit RPC.
- **AI router:** consent gate and allowlists.

**Tech Stack:** Next.js 16.3 (App Router, proxy.ts, server actions, route handlers), React 19, TypeScript strict, Supabase (Postgres/RLS/Storage/Auth, `@supabase/ssr`), vitest 5, Playwright, pnpm 10, GitHub Actions.

**Spec:** `AUDIT_REPORT.md` (repo root, and `F:\Orbis\orbis\AUDIT_REPORT.md` if it isn't in this branch) plus `docs/superpowers/plans/2026-09-28-productization-roadmap.md`. Each task cites the audit finding it fixes.

## Global Constraints

- Work only in the worktree `F:\Orbis\orbis\.worktrees\phase-1` (branch `phase-1`). Never touch `F:\Orbis\orbis` itself; another session has uncommitted work there.
- **Do not edit these files.** The other session has uncommitted changes to them:
  - `app/personal/actions.ts`, `app/personal/journal-actions.ts`, `app/routines/actions.ts`
  - `components/personal/journal.tsx`, `components/personal/context-notes.tsx`, `components/personal/routine-settings.tsx`
  - `lib/journal/*`, `lib/routines/*`
  - `lib/notifications/compose.ts`, `lib/notifications/context.ts`
  - `supabase/pending.sql`, `BUILD_ROADMAP.md`
  - `components/personal/profile-screen.tsx` is limited to one small additive change (Task 7).
  - The two exceptions are the one-line import swaps in `lib/home/note.test.ts` and `lib/routines/today.test.ts` (Task 1).
- New migrations are numbered `202609280200_*` upward. The other session uses `0100–0103`. Every migration must be idempotent (`if not exists`, `drop … if exists` before `create policy`/`create trigger`/`add constraint`).
- Next.js has breaking changes. Read the relevant file under `node_modules/next/dist/docs/` before using an API (CSP guide: `01-app/02-guides/content-security-policy.md`; proxy: `01-app/03-api-reference/03-file-conventions/proxy.md`).
- User-facing copy is plain, calm, second person, and never names env vars, migrations, tables or providers' internals. Server-side detail goes to `console.error`.
- Server actions return `{ success: boolean; message: string; … }`. Errors meant for the user are typed; everything else becomes a generic message.
- Every server entry point derives the user from `supabase.auth.getClaims()` plus `isAppUnlocked()`. It never accepts a user id from the browser.
- `pnpm build` must pass at the end of every task. From Task 1 on, `pnpm test` and `pnpm lint` must also pass. After a build, if `next-env.d.ts` changed from `.next/dev/types` to `.next/types`, restore it with `git checkout -- next-env.d.ts`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Stage files by path; never `git add -A`.

## Review Focus

1. The CSP must not break the signed-in app: inline `style={…}` attributes, the inline theme script, Supabase auth, storage images, media, web push and passkeys all still work. Expected: no CSP violation in the browser console on `/login` or `/`. The Task 2 Playwright smoke test checks this.
2. A signed-in session without fresh authentication (a stolen cookie, or a locked phone) must not be able to change the password, delete the account or export data. Tasks 4 and 7 each include a unit test for the freshness rule.
3. Account deletion must remove storage files as well as rows, and must not leave the user signed in to a half-deleted account if a step fails midway. Order the steps so the auth user is deleted last. Task 7 tests the ordering helper.
4. Rate limits must count atomically under concurrent requests (two uploads at once cannot both slip under a limit of 1). The Task 5 SQL uses `insert … on conflict … do update … where … returning`.
5. Code splitting must keep Home fast and not flash an empty screen when switching tabs. Each dynamic tab gets a `loading` fallback, and Task 3's smoke test switches every tab.

---

### Task 1: Tooling — one green test command, lint, pinned versions, CI

Audit: H14, H15, H16, and the Low item "unpinned dependencies".

**Files:**
- Modify `package.json`:
  - scripts: `test` → `vitest run`, `lint` → `eslint .`, add `typecheck` → `tsc --noEmit`
  - pin every `latest` to the version in `pnpm-lock.yaml`, as a caret range
  - add `"packageManager": "pnpm@10.18.2"` and `"engines": { "node": ">=22" }`
  - devDeps: `eslint`, `eslint-config-next` (matching the next version), `@eslint/eslintrc` if the codemod needs it
- Modify every test file that imports `node:test`:
  - `lib/brief/style.test.ts`, `lib/focus/social.test.ts`, `lib/focus/tabs.test.ts`, `lib/home/ai-brief.test.ts`, `lib/home/note.test.ts`, `lib/notifications/schedule.test.ts`, `lib/routines/today.test.ts`
  - `lib/security/access.test.ts`, `lib/security/pin.test.ts`, `lib/security/unlock-token.test.ts`
  - `lib/social/ai-draft.test.ts`, `lib/social/month.test.ts`, `lib/social/validate.test.ts`
  - The change is exactly `import { test } from 'node:test';` → `import { test } from 'vitest';`. Keep `node:assert/strict`, which works under vitest. If a file imports `describe`/`it` from `node:test`, swap those the same way.
- Create `eslint.config.mjs` (flat config).
- Create `.github/workflows/ci.yml`.
- Create `.gitattributes`: `* text=auto eol=lf`, plus `*.png binary`, `*.ico binary`, `*.svg text`.
- Modify `README.md`: only the "Tests" lines, if present, to say `pnpm test`.

**Interfaces:**
- Produces: `pnpm test` exits 0 over every `lib/**/*.test.ts`; `pnpm lint` exits 0; `pnpm typecheck` exits 0. Later tasks rely on these commands.

- [ ] **Step 1: Prove the current failure.** Run `pnpm test; echo "exit $?"`. Expected: vitest prints `No test suite found` for the node:test files, and exit 1.
- [ ] **Step 2: Swap the imports.** In every file listed above, replace `from 'node:test'` with `from 'vitest'`. Check with `grep -rn "node:test" lib --include=*.test.ts`, which should find nothing.
- [ ] **Step 3: Run the suite.** `pnpm test`. Expected: every test file passes and the command exits 0 (about 150 tests). If a test relied on node:test-only behaviour such as `t.mock`, port it to `vi` and note it in the commit message.
- [ ] **Step 4: Set up ESLint.**
  - Run `npx @next/codemod@canary next-lint-to-eslint-cli . --dry` to see the proposed change, then apply it. If the codemod doesn't fit, write this by hand:

```js
// eslint.config.mjs
import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  { ignores: ['.next/**', 'node_modules/**', 'tests/e2e/.report/**', 'tests/e2e/.results/**', 'public/**', '.worktrees/**'] },
];
export default config;
```

  - Run `pnpm lint`. Fix real errors, meaning hook-rule violations and unused variables. Where a rule fights an intentional pattern already documented in a comment (for example `react-hooks/exhaustive-deps` in `components/social/social-screen.tsx`), keep the existing `eslint-disable-next-line` with its reason.
  - Do not reformat files wholesale. Warnings may stay; errors may not.
- [ ] **Step 5: Pin the versions.** Read the resolved versions from `pnpm-lock.yaml` (for example `next 16.3.6`, `react 19.3.0`, `typescript 7.0.2`, `lucide-react 1.47.0`, `recharts 3.10.1`) and write them as `^x.y.z`. Run `pnpm install` (the lockfile should not change majors), then `pnpm typecheck`.
- [ ] **Step 6: Add CI** in `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_SUPABASE_URL: https://example.supabase.co
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sb_publishable_ci_placeholder
      NEXT_PUBLIC_SITE_URL: https://example.com
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm audit --prod --audit-level=high
```

- [ ] **Step 7: Verify.** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, all exiting 0. Restore `next-env.d.ts` if the build changed it.
- [ ] **Step 8: Commit** with message "Make tests, lint and CI work: vitest everywhere, ESLint flat config, pinned versions".

---

### Task 2: Security headers and a nonce-based Content Security Policy

Audit: Medium "No security headers".

**Files:**
- Create `lib/security/csp.ts`: a pure builder, tested.
- Create `lib/security/csp.test.ts`.
- Modify `proxy.ts`: generate a nonce per request, set `x-nonce` on the request and `Content-Security-Policy` on the response, and keep `updateSession`.
- Modify `lib/supabase/proxy.ts` if it creates its own `NextResponse`. The CSP header must end up on the response `updateSession` returns. Read that file first.
- Modify `next.config.ts`: `poweredByHeader: false`, and `headers()` for the static security headers (HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy).
- Modify `app/layout.tsx`: read the nonce from `headers()` (`x-nonce`) and put it on the inline theme `<script nonce={nonce}>`.
- Create `tests/e2e/public/headers.spec.ts`, a Playwright test that needs no sign-in, plus a Playwright project or config entry that can run the `public` folder without the global setup. Read `playwright.config.ts` first: its globalSetup creates users in production, so the public smoke tests need their own config file `playwright.public.config.ts` with no globalSetup and `webServer: pnpm build && pnpm start -p 3100`.

**Interfaces:**
- Produces: `buildCsp({ nonce, supabaseUrl, isDev }): string` in `lib/security/csp.ts`, and `playwright.public.config.ts` with a `pnpm test:public` script. Tasks 3, 6 and 10 add specs to `tests/e2e/public/`.

- [ ] **Step 1: Write the failing test** `lib/security/csp.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildCsp } from './csp';

const csp = buildCsp({ nonce: 'abc123', supabaseUrl: 'https://proj.supabase.co', isDev: false });
const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

test('scripts need the nonce and nothing inline or eval in production', () => {
  assert.match(directive('script-src'), /'nonce-abc123'/);
  assert.match(directive('script-src'), /'strict-dynamic'/);
  assert.doesNotMatch(directive('script-src'), /unsafe-inline|unsafe-eval/);
});

test('dev allows eval for React debugging only', () => {
  assert.match(buildCsp({ nonce: 'n', supabaseUrl: 'https://proj.supabase.co', isDev: true }), /'unsafe-eval'/);
});

test('the app cannot be framed and forms only post to itself and the OAuth providers', () => {
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.match(directive('form-action'), /'self'/);
  assert.equal(directive('object-src'), "object-src 'none'");
});

test('supabase is reachable for data, realtime, images and media', () => {
  assert.match(directive('connect-src'), /https:\/\/proj\.supabase\.co/);
  assert.match(directive('connect-src'), /wss:\/\/proj\.supabase\.co/);
  assert.match(directive('img-src'), /https:\/\/proj\.supabase\.co/);
  assert.match(directive('media-src'), /https:\/\/proj\.supabase\.co/);
});

test('inline style attributes keep working (the UI uses style={…})', () => {
  assert.match(directive('style-src'), /'unsafe-inline'/);
});
```

- [ ] **Step 2: Run it.** `pnpm test lib/security/csp.test.ts`. Expected: FAIL, because `./csp` doesn't exist.
- [ ] **Step 3: Implement `lib/security/csp.ts`:**

```ts
// The Content-Security-Policy, built per request so scripts can carry a nonce.
//
// style-src keeps 'unsafe-inline' because React style={…} attributes are inline
// styles and the UI uses them for bars and rings; scripts are the attack surface
// CSP exists for, and those are nonce-only with 'strict-dynamic'.
export function buildCsp({ nonce, supabaseUrl, isDev }: { nonce: string; supabaseUrl: string; isDev: boolean }) {
  const supabase = supabaseUrl.replace(/\/+$/, '');
  const realtime = supabase.replace(/^https:/, 'wss:');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${realtime}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://kite.zerodha.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
```

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Wire the proxy.** Following the CSP guide, generate the nonce with `Buffer.from(crypto.randomUUID()).toString('base64')`. Pass request headers carrying `x-nonce` and `Content-Security-Policy` into the request that `updateSession` forwards, and set `Content-Security-Policy` on the final response. Keep the existing matcher and add prefetch exclusions as the guide shows. Then add in `app/layout.tsx`: `const nonce = (await headers()).get('x-nonce') ?? undefined;` and `<script nonce={nonce} …>`. The layout becomes async if it isn't already.
- [ ] **Step 6: Static headers.** In `next.config.ts` add `poweredByHeader: false` and:

```ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self), payment=()' },
    ],
  }];
},
```

- [ ] **Step 7: Public smoke test.** Create `playwright.public.config.ts` (no globalSetup/teardown, `testDir: 'tests/e2e/public'`, webServer `pnpm build && pnpm start -p 3100`, env `ORBIS_ALLOWED_EMAILS: ''`) and `tests/e2e/public/headers.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('login page sends the security headers and raises no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto('/login');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toMatch(/nonce-/);
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  expect(violations).toEqual([]);
});
```

  Add the script `"test:public": "playwright test -c playwright.public.config.ts"`. Run `pnpm test:public`. Expected: PASS. If the sign-in button's accessible name differs, read `components/auth/auth-form.tsx` and use the real one.
- [ ] **Step 8: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 9: Commit** "Add a nonce-based Content Security Policy and security headers".

---

### Task 3: Performance quick wins

Audit: H2–H6, and the Mediums "34 uncached calls", "wasted Zerodha query" and "AI router has no overall deadline".

**Files:**
- Modify `components/orbis-app.tsx`:
  - Remove the Home `router.refresh()` on mount. Keep a visibility refresh only when the page was hidden for 60 s or more.
  - Load FinanceScreen's heavy children, HealthScreen's charts and plan view, `InvestDashboard`, `SocialScreen` and `ProfileScreen` with `next/dynamic`, each with a `loading` fallback (`<div className="screen-body field"><p className="fd-empty">Loading…</p></div>`).
  - Request the AI brief only after weather has settled and the portfolio has loaded or failed.
- Create `app/api/home/brief/route.ts` and `app/api/home/portfolio/route.ts`: GET route handlers wrapping the current `loadHomeBriefAction` / `loadBriefPortfolioAction` logic. Move the shared logic into `lib/home/brief-service.ts` and `lib/home/portfolio-service.ts` so the actions, if still used anywhere, and the routes share it. Home calls them with `fetch(…, { cache: 'no-store' })`.
- Modify `app/home/brief-actions.ts` and `app/invest/actions.ts` only to delegate to the new service modules.
- Modify `app/page.tsx`: run `getPinStatus(userId)` and `isAppUnlocked(claims)` in parallel. The big `Promise.all` still runs only after the unlock check passes.
- Modify `lib/providers/status.ts:125`: remove the unused `zerodha_connections` query.
- Modify `lib/ai/router.ts`: add one overall deadline (`deadline = Date.now() + (request.timeoutMs ?? 15_000) * 1.5`, capped at 50 s), give each attempt `Math.min(timeoutMs, deadline - Date.now())`, and stop when under 1.5 s remain. Run `logAttempt`/`penalise` inside `after()` from `next/server`.
- Remove client `router.refresh()` calls that directly follow a server action that already calls `revalidatePath('/')`, in files this task may edit:
  - `components/orbis-app.tsx`
  - `components/finance/*`, `components/health/*`, `components/invest/*`, `components/social/*`
  - `components/home/*`, `components/personal/notification-settings.tsx`, `components/personal/app-integrations.tsx`, `components/personal/home-brief-setting.tsx`
  - Before deleting each call, check the action revalidates. Keep a refresh where the action does not revalidate, and list those kept in the commit message.
- Create `lib/home/brief-gate.ts`: a pure `briefReady({ weather, portfolioSettled })`, tested.
- Create `lib/home/brief-gate.test.ts`.
- Create `tests/e2e/public/landing-speed.spec.ts` if Task 6 hasn't created a landing page yet. Otherwise skip, since the signed-in shell cannot be smoke-tested without users.

**Interfaces:**
- Consumes: Task 1's `pnpm test`.
- Produces:
  - `GET /api/home/brief?weather=<json>` → `{ state: 'ok', caption } | { state: 'off' | 'skip' }`, the same shape `loadHomeBriefAction` returns today.
  - `GET /api/home/portfolio` → `BriefPortfolio | null`.
  - `briefReady()`.

- [ ] **Step 1: Failing test** for the gate:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { briefReady } from './brief-gate';

test('waits while weather is still loading', () => {
  assert.equal(briefReady({ weather: 'loading', portfolioSettled: true }), false);
});
test('waits for the portfolio to load or fail', () => {
  assert.equal(briefReady({ weather: 'ready', portfolioSettled: false }), false);
});
test('asks once weather has any final state and the portfolio has settled', () => {
  for (const weather of ['ready', 'error', 'needs-city', 'off'] as const) assert.equal(briefReady({ weather, portfolioSettled: true }), true);
});
```

- [ ] **Step 2: Run it.** `pnpm test lib/home/brief-gate.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `export type WeatherPhase = 'loading' | 'ready' | 'error' | 'needs-city' | 'off'; export function briefReady({ weather, portfolioSettled }: { weather: WeatherPhase; portfolioSettled: boolean }) { return weather !== 'loading' && portfolioSettled; }`. Run the test. Expected: PASS.
- [ ] **Step 4: Wire it into Home.** `WeatherCard` currently calls `onWeather(weather)` when it has weather. Read `components/home/weather-card.tsx` and add an `onPhase(phase: WeatherPhase)` callback without changing what it renders. Home keeps `weatherPhase` and `portfolioSettled` state (set when the portfolio fetch resolves or rejects, or after an 8 s timeout). The brief effect runs only when `briefReady(...)` is true, and at most once per `dataKey` (guard with a ref holding the last key sent).
- [ ] **Step 5: Route handlers.** Move the bodies of `loadHomeBriefAction` / `loadBriefPortfolioAction` into the service modules, taking `userId` and the inputs. The routes derive the user exactly as the actions do (`getClaims` plus `isAppUnlocked`), return 401 JSON `{ state: 'off' }` / `null` when not allowed, and set `Cache-Control: no-store`. Home switches from the actions to `fetch('/api/home/brief?weather=' + encodeURIComponent(JSON.stringify(weather)))` and `fetch('/api/home/portfolio')`, each wrapped in try/catch with the current fallbacks.
- [ ] **Step 6: Dynamic tabs.** Replace the static imports with `const InvestDashboard = dynamic(() => import('@/components/invest/invest-dashboard').then((m) => m.InvestDashboard), { loading: TabLoading });`, and the same for `SocialScreen`, `ProfileScreen`, `StepsCard`, `PlanBuilder`, `HealthLibrary`, `WorkbookAsk`/`WorkbookAdviceView`, `GmailReviewQueue`, `ManualTransactionForm` and `SpendingSummary`. The inline FinanceScreen and HealthScreen functions stay; their imports become dynamic. `TabLoading` is a small local component.
- [ ] **Step 7: Refresh cleanup** as described under Files. Remove the Home mount refresh. The visibility handler records `hiddenAt` on `hidden` and refreshes on `visible` only if `Date.now() - hiddenAt >= 60_000`.
- [ ] **Step 8: Page, status and router** changes as described under Files.
- [ ] **Step 9: Measure.** Run `pnpm build`, then compute the gzip size of the `/` route's JS the same way the audit did: sum the gzip of the chunks listed for `/` in `.next/app-build-manifest.json`, or the Next 16 equivalent. Put the before (392 KB modern) and after numbers in the commit message. Target: at most 250 KB.
- [ ] **Step 10: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 11: Commit** "Make Home fast: one render per open, brief asked once, tabs load on demand".

---

### Task 4: Auth and data hardening

Audit: Medium "password change without re-auth" and "push endpoints SSRF"; Lows "Zerodha state", "enumeration and weak passwords", "table grants", "PIN search_path", "AI router trusts the database", "raw error messages".

**Files:**
- Create `lib/security/fresh-auth.ts`: a pure `canChangePassword({ amr, nowSec, unlocked, currentPasswordVerified })`, tested.
- Create `lib/security/fresh-auth.test.ts`.
- Modify `app/auth/actions.ts`:
  - `updatePassword` enforces `canChangePassword`. A recovery or OTP AMR entry no older than 15 minutes passes. Otherwise the form must include `currentPassword`, which is verified with `signInWithPassword` for the claims email, and the app must be unlocked.
  - Sign-in returns one generic message for `invalid_credentials` and `email_not_confirmed`.
  - Sign-up requires 10+ characters.
- Modify `app/reset-password/page.tsx` and its form component: show a "Current password" field when the session isn't a fresh recovery. The page decides this from the claims' `amr` on the server and passes a `needsCurrentPassword` prop.
- Create `supabase/migrations/202609280200_hardening.sql`:
  - a push endpoint host CHECK
  - revoke direct insert/update on `push_subscriptions` from authenticated (keep select and delete)
  - `notification_log`: revoke update, then grant update (read_at)
  - `consume_app_pin_attempt` search_path set to `''`
  - tighten table grants on the tables the audit lists as relying on defaults, except those in the other session's uncommitted migrations
- Modify `app/personal/notification-actions.ts` (not in the do-not-edit list): the subscribe action writes through the admin client scoped to the user, because direct insert is revoked. Keep the https check and the 10-device cap.
- Modify `lib/notifications/push.ts`: `webpush.sendNotification(sub, payload, { timeout: 5000 })`, and send with bounded concurrency (4 at a time).
- Create `lib/notifications/push-endpoint.ts`: a pure `isAllowedPushEndpoint(url)`, tested, using the same host list as the SQL CHECK.
- Create `lib/notifications/push-endpoint.test.ts`.
- Modify `app/auth/zerodha/start/route.ts` and `app/auth/zerodha/callback/route.ts`: an HMAC-signed state cookie bound to the user id, mirroring the Gmail pattern in `lib/gmail/oauth.ts`. Reuse its signing helper if it's exported; otherwise extract it to `lib/security/oauth-state.ts` and use it from both.
- Modify `lib/ai/router.ts`: `ALLOWED_KEY_ENVS = new Set(['GROQ_API_KEY','OPENROUTER_API_KEY','GEMINI_API_KEY','MISTRAL_API_KEY'])` and `ALLOWED_HOSTS = new Set(['api.groq.com','openrouter.ai','generativelanguage.googleapis.com','api.mistral.ai'])`. Skip any registry row whose `api_key_env` or `new URL(base_url).host` isn't allowed. First check the seed rows in `supabase/migrations/*ai_registry*.sql` and include exactly the hosts used there.
- Modify the actions that echo raw `error.message`, where editable: `app/health/library-actions.ts`, `app/invest/actions.ts`. Introduce `lib/errors.ts` exporting `class UserFacingError extends Error {}` and `userMessage(error, fallback)`. Log unknown errors with `console.error`.

**Interfaces:**
- Produces:
  - `canChangePassword(input): { ok: true } | { ok: false; needs: 'current-password' | 'unlock' }`
  - `isAllowedPushEndpoint(url: string): boolean`
  - `lib/security/oauth-state.ts` (`signState(userId)`, `verifyState(cookie, param, userId)`), if extracted
  - `UserFacingError`, `userMessage()`
  - Task 7 reuses `canChangePassword`'s freshness rule.

- [ ] **Step 1: Failing tests.**

```ts
// lib/security/fresh-auth.test.ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canChangePassword } from './fresh-auth';

const now = 1_800_000_000;
test('a recovery sign-in within 15 minutes may change the password', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'recovery', timestamp: now - 60 }], nowSec: now, unlocked: false, currentPasswordVerified: false }), { ok: true });
});
test('an old recovery does not count', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'recovery', timestamp: now - 3600 }], nowSec: now, unlocked: true, currentPasswordVerified: false }), { ok: false, needs: 'current-password' });
});
test('a normal session needs the current password and an unlocked app', () => {
  assert.deepEqual(canChangePassword({ amr: [{ method: 'password', timestamp: now - 10 }], nowSec: now, unlocked: false, currentPasswordVerified: true }), { ok: false, needs: 'unlock' });
  assert.deepEqual(canChangePassword({ amr: [{ method: 'password', timestamp: now - 10 }], nowSec: now, unlocked: true, currentPasswordVerified: true }), { ok: true });
});
test('garbage amr is treated as not fresh', () => {
  assert.deepEqual(canChangePassword({ amr: 'x', nowSec: now, unlocked: true, currentPasswordVerified: false }), { ok: false, needs: 'current-password' });
});
```

```ts
// lib/notifications/push-endpoint.test.ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAllowedPushEndpoint } from './push-endpoint';

test('real push services are allowed', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QK', 'https://wns2-par02p.notify.windows.com/w/?token=1']) assert.equal(isAllowedPushEndpoint(url), true, url);
});
test('anything else is refused', () => {
  for (const url of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/latest', 'not a url']) assert.equal(isAllowedPushEndpoint(url), false, url);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement both pure modules.** `canChangePassword` reads `amr` the way `hasFreshAuth` in `lib/security/unlock-token.ts` does, filtering methods `recovery` and `otp`, with a 15-minute window. `isAllowedPushEndpoint` parses with `new URL`, requires `https:`, and matches host exactly `fcm.googleapis.com`, `updates.push.services.mozilla.com` or `web.push.apple.com`, or ending in `.notify.windows.com` or `.push.apple.com`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Migration** `202609280200_hardening.sql`:

```sql
-- Phase 1 hardening: push endpoints may only point at real push services, the
-- app writes subscriptions itself, and grants say exactly what each role may do.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_host;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
) not valid;
revoke insert, update on public.push_subscriptions from authenticated;

revoke update on public.notification_log from authenticated;
grant update (read_at) on public.notification_log to authenticated;

alter function public.consume_app_pin_attempt(uuid) set search_path = '';
```

  Before writing the grants part, read the migrations the audit named (`202609240019_notification_log.sql`, `202609240017_health_documents_plans.sql:684-686`, `202609240020` ai_results) and add `revoke all … from authenticated` plus the exact intended grants for those tables. `not valid` keeps existing rows; the DB still checks new writes.
- [ ] **Step 6: Wire the actions, push, Zerodha state and router allowlist** as described under Files. For Zerodha, Kite supports `redirect_params`: pass `state=<value>` URL-encoded in `redirect_params` on the login URL, and read `state` back in the callback. Read `lib/invest/zerodha.ts` for the login URL builder.
- [ ] **Step 7: Password UI.** `app/reset-password/page.tsx` computes `needsCurrentPassword` from claims and passes it to the form. The form shows the field and the action verifies it.
- [ ] **Step 8: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:public`.
- [ ] **Step 9: Commit** "Harden auth and data: re-auth for password change, push endpoint allowlist, Zerodha state, router allowlists".

---

### Task 5: Rate limits, storage caps and signed direct uploads

Audit: Mediums "no rate limits or storage quotas" and "uploads over ~4.5 MB fail on Vercel".

**Files:**
- Create `supabase/migrations/202609280201_rate_limits.sql`: table `public.rate_limit_buckets (user_id, bucket, window_start, used)` and function `consume_rate_limit(p_user_id uuid, p_bucket text, p_limit int, p_window_seconds int) returns boolean`. It is security definer with `search_path ''`, executable only by service_role, and atomic.
- Create `lib/security/rate-limit.ts`: `consumeRateLimit(userId, bucket: RateBucket)`, where `RATE_LIMITS` holds the numbers. It uses the admin client and returns `'ok' | 'limited' | 'unavailable'`.
- Create `lib/security/rate-limit.test.ts`: tests the pure `limitFor(bucket)` table and `rateLimitMessage(bucket)` copy.
- Create `lib/storage/signed-upload.ts`:
  - `createUploadTarget(userId, kind: 'health-document' | 'workbook', file: { name, type, size })` validates type and size and returns `{ path, token }` from the admin client's `createSignedUploadUrl` on the right bucket.
  - `downloadOwned(userId, kind, path)` checks the path starts with `${userId}/` and returns the bytes.
- Modify the health-document upload and workbook parse: `app/health/library-actions.ts`, `app/health/actions.ts`, and their components `components/health/health-library.tsx`, `components/health/workbook-advisor.tsx`.
  - Flow: the browser asks for a target, uploads with `supabase.storage.from(bucket).uploadToSignedUrl`, then calls the action with `{ path }`.
  - The action downloads from storage and runs the existing parse and index code unchanged.
  - Workbooks go to a new private bucket `workbook-uploads`, created in the migration with a 100 MB limit and xlsx/pdf MIME types. Files there are deleted after parsing.
- Modify `next.config.ts`: `bodySizeLimit: '4mb'`.
- Apply `consumeRateLimit` to:
  - health document upload: `uploads`, 20/day
  - workbook parse: `parse`, 20/day
  - Gmail sync (`app/finance/actions.ts` sync action): `sync`, 30/hour
  - social media upload signing (`app/social/actions.ts signMediaUploadAction`): `uploads`
- Add a per-user document cap: at most 50 health documents; the upload action counts before signing.

**Interfaces:**
- Produces: `consumeRateLimit(userId: string, bucket: 'uploads' | 'parse' | 'sync'): Promise<'ok' | 'limited' | 'unavailable'>`, `rateLimitMessage(bucket)`, `createUploadTarget`, `downloadOwned`.

- [ ] **Step 1: Failing test:**

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { limitFor, rateLimitMessage } from './rate-limit-rules';

test('each bucket has a sane limit and window', () => {
  assert.deepEqual(limitFor('uploads'), { limit: 20, windowSeconds: 86_400 });
  assert.deepEqual(limitFor('parse'), { limit: 20, windowSeconds: 86_400 });
  assert.deepEqual(limitFor('sync'), { limit: 30, windowSeconds: 3_600 });
});
test('the message is plain and says when to try again', () => {
  assert.match(rateLimitMessage('sync'), /try again in an hour/i);
  assert.match(rateLimitMessage('uploads'), /tomorrow/i);
});
```

  Put the pure part in `lib/security/rate-limit-rules.ts` so the test does not import `server-only`. `rate-limit.ts` imports the rules.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the rules and the server wrapper. The SQL:

```sql
create table if not exists public.rate_limit_buckets (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z_]{2,30}$'),
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, bucket, window_start)
);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(p_user_id uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds);
  v_used integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then return false; end if;
  insert into public.rate_limit_buckets (user_id, bucket, window_start, used)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
  do update set used = public.rate_limit_buckets.used + 1
    where public.rate_limit_buckets.used < p_limit
  returning used into v_used;
  return v_used is not null;
end; $$;
revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workbook-uploads', 'workbook-uploads', false, 104857600,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf'])
on conflict (id) do nothing;
```

- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Signed uploads.** Read `app/health/library-actions.ts`, `app/health/actions.ts` and both components first. Keep the parsing and indexing functions unchanged; only the transport changes (FormData File → storage path). Keep the client-side size and type checks. Existing copy that promises 100 MB workbooks and 50 MB documents stays true.
- [ ] **Step 6: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 7: Commit** "Rate-limit uploads, parsing and sync; upload large files straight to storage".

---

### Task 6: Public pages — landing, privacy, terms, support, delete-account, robots, sitemap, metadata

Audit: H7 and the Mediums "no terms or support" and "no landing page"; SEO Lows.

**Files:**
- Create `lib/site.ts`:
  - `SITE_NAME = 'Orbis'`
  - `siteUrl()`, from `NEXT_PUBLIC_SITE_URL` with a `https://orbis-starter.vercel.app` fallback
  - `supportEmail()`, from `NEXT_PUBLIC_SUPPORT_EMAIL`, returning null when unset
  - `LEGAL_UPDATED = '2026-09-28'`
- Create `components/marketing/public-shell.tsx`: a shared header (logo, Sign in) and footer (Privacy, Terms, Support, Delete account), using the Atlas/Field tokens from `app/globals.css`.
- Create `components/marketing/landing.tsx`:
  - hero line: "One calm daily brief for your money, health and routines."
  - three feature rows: Brief, Money, Health
  - a privacy section explaining that AI never trains on your data, with the router rule in plain words
  - a Sign in / Create account CTA
- Modify `app/page.tsx`: when there are no claims, render `<Landing />` instead of `redirect('/login')`. Signed-in behaviour is unchanged.
- Create `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/support/page.tsx`, `app/delete-account/page.tsx`: static server components with metadata.
  - **Privacy** lists the actual data: account email; transactions and bank alerts from Gmail (read-only, alerts only); broker holdings; steps; health documents; journal, notes and voice notes; routines; social posts and media; approximate location for weather; push tokens. It also covers:
    - processors: Supabase, Vercel, Google (Gmail, Calendar), Zerodha, Groww, the AI providers named in `supabase/migrations/*ai_registry*.sql`, Open-Meteo and the market-data APIs named in `lib/providers/*`
    - why each is used; retention (until you delete it); deletion (Profile → Account → Delete account, or `/delete-account`)
    - the AI no-training rule; no ads, no tracking, no selling of data
    - children (not for under 18)
    - contact: the support email if set, else "through the support page"
    - India DPDP grievance contact: the same address
  - **Terms** covers: not financial, medical or tax advice; read-only connections; the user's responsibility for their credentials; availability; termination; limitation of liability; governing law India.
  - **Support** gives the email or the "coming soon" copy and links the FAQ-style answers to "how do I delete…".
  - **Delete-account** explains the in-app path and what gets deleted, and says the user can email support if they can't sign in.
- Create `app/robots.ts`: allow `/`, disallow `/api/`, `/auth/`, `/reset-password`; point at the sitemap.
- Create `app/sitemap.ts`: `/`, `/privacy`, `/terms`, `/support`, `/delete-account`.
- Modify `app/layout.tsx` metadata: `metadataBase: new URL(siteUrl())`, a title template `%s — Orbis`, a 120–160 character description, `openGraph`, `twitter` (summary_large_image), `alternates.canonical: '/'`.
- Create `app/opengraph-image.tsx`: a generated OG image using `next/og` `ImageResponse` with the brand colours. Read the Next 16 docs for `opengraph-image`.
- Modify `app/login/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`: `robots: { index: false }`, and a footer with Privacy and Terms links.
- Create `lib/site.test.ts`.
- Create `tests/e2e/public/pages.spec.ts`.
- Modify `README.md`: a short "Public pages" line.

**Interfaces:**
- Produces: `siteUrl()`, `supportEmail()`, the `/privacy` and `/delete-account` URLs (Task 7 links to them), and `PublicShell` (Task 10's offline page uses it).

- [ ] **Step 1: Failing tests:**

```ts
// lib/site.test.ts
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { siteUrl, supportEmail } from './site';

afterEach(() => { delete process.env.NEXT_PUBLIC_SITE_URL; delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL; });
test('siteUrl trims a trailing slash and falls back to the production URL', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://orbis.app/';
  assert.equal(siteUrl(), 'https://orbis.app');
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(siteUrl(), 'https://orbis-starter.vercel.app');
});
test('supportEmail is null until it is configured, and rejects junk', () => {
  assert.equal(supportEmail(), null);
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'help@orbis.app';
  assert.equal(supportEmail(), 'help@orbis.app');
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'not-an-email';
  assert.equal(supportEmail(), null);
});
```

```ts
// tests/e2e/public/pages.spec.ts
import { expect, test } from '@playwright/test';

for (const [path, heading] of [['/', /daily brief/i], ['/privacy', /privacy/i], ['/terms', /terms/i], ['/support', /support/i], ['/delete-account', /delete/i]] as const) {
  test(`${path} renders for signed-out visitors`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByRole('link', { name: 'Privacy' }).first()).toBeVisible();
  });
}
test('robots and sitemap are served', async ({ request }) => {
  expect(await (await request.get('/robots.txt')).text()).toMatch(/Sitemap:/);
  expect(await (await request.get('/sitemap.xml')).text()).toMatch(/\/privacy/);
});
test('auth pages are not indexed', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
```

- [ ] **Step 2: Run them.** `pnpm test lib/site.test.ts` (FAIL). `pnpm test:public` fails on the new spec.
- [ ] **Step 3: Implement** `lib/site.ts`, then the pages and metadata. Write the legal pages in plain English, with short sections and h2 headings. Mark nothing as legal advice.
- [ ] **Step 4: Run both test commands.** Expected: PASS. The Task 2 headers spec must still pass: no CSP violations on `/`.
- [ ] **Step 5: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 6: Commit** "Add the public site: landing, privacy, terms, support, delete-account, robots, sitemap and share previews".

---

### Task 7: Account deletion, data export and social history purge

Audit: H8 and the Medium "no account deletion".

**Files:**
- Create `lib/account/deletion-plan.ts`: pure. `deletionSteps()` returns the ordered step ids: `['revoke-connections', 'remove-storage', 'delete-user']`. `STORAGE_BUCKETS = ['health-documents', 'social-media', 'journal-voice', 'workbook-uploads']`. `EXPORT_TABLES` is the list of `{ table, columns: '*' }` the export reads, derived by reading every migration for tables with a `user_id` column; exclude service-role-only secret tables such as `gmail_connections` token columns, `groww_connections` and `zerodha_connections`.
- Create `lib/account/deletion-plan.test.ts`.
- Create `lib/account/delete.ts` (server-only):
  - `deleteAccount(userId, email)` runs the steps in order with the admin client:
    - revoke the Gmail refresh token: reuse the existing disconnect/revoke code in `lib/gmail/*`, and read `app/finance/actions.ts disconnectGmailAction` to find it
    - delete the Zerodha and Groww connection rows
    - list and remove every object under `${userId}/` in each bucket, paging with `list` until empty; a missing bucket is skipped
    - `auth.admin.deleteUser(userId)`, which cascades the rows
  - Any failure before `delete-user` throws a `UserFacingError` saying nothing was deleted from the account yet; storage may already be partly removed, so the copy should admit that.
- Create `app/account/actions.ts`:
  - `deleteAccountAction(input: { password?: string; confirm: string })`
    - requires `confirm === 'DELETE'`
    - requires fresh authentication: either `hasFreshAuth(amr, now, 600)` (any method within 10 minutes), or `password` verified with `signInWithPassword` for the claims email
    - requires `isAppUnlocked`
    - on success signs out and returns `{ success: true }`
  - `purgeSocialHistoryAction()` deletes the user's `social_post_revisions` rows with the admin client scoped by user_id. The table only grants select/insert to users, which keeps history honest, so the purge is an explicit server action.
- Create `app/api/account/export/route.ts`: GET, authed and unlocked, reads every `EXPORT_TABLES` table with the user's RLS client, and returns `application/json` with `Content-Disposition: attachment; filename="orbis-export-YYYY-MM-DD.json"` and a list of storage object paths. Files themselves aren't included; the JSON says how to download them.
- Create `components/personal/account-data.tsx`:
  - an "Export my data" link to `/api/account/export`
  - a "Delete social post history" button with a confirm sheet
  - a "Delete account" section: explains what is deleted, a password field (optional when the session is fresh), a type-DELETE field and a destructive button
- Modify `components/personal/profile-screen.tsx`: one additive change, rendering `<AccountData />` inside the existing Account group next to Sign out.

**Interfaces:**
- Consumes: `hasFreshAuth` (`lib/security/unlock-token.ts`), `UserFacingError` (Task 4), `/delete-account` (Task 6).
- Produces: `deleteAccountAction`, `purgeSocialHistoryAction`, `GET /api/account/export`.

- [ ] **Step 1: Failing tests:**

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EXPORT_TABLES, STORAGE_BUCKETS, deletionSteps } from './deletion-plan';

test('the auth user is deleted last, after connections and files', () => {
  assert.deepEqual(deletionSteps(), ['revoke-connections', 'remove-storage', 'delete-user']);
});
test('every private bucket is emptied', () => {
  for (const bucket of ['health-documents', 'social-media', 'journal-voice', 'workbook-uploads']) assert.ok(STORAGE_BUCKETS.includes(bucket), bucket);
});
test('the export never includes stored credentials', () => {
  const tables = EXPORT_TABLES.map((entry) => entry.table);
  for (const secret of ['gmail_connections', 'groww_connections', 'zerodha_connections', 'user_app_pins', 'push_subscriptions']) assert.ok(!tables.includes(secret), secret);
  for (const table of ['transactions', 'social_posts', 'routines']) assert.ok(tables.includes(table), table);
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the plan module, reading the migrations for the table list, then `delete.ts`, the actions, the export route and the UI. Check in the migrations that every user table references `auth.users` with `on delete cascade`. List any table without it in the commit message, and add a migration `202609280202_cascade_fixes.sql` if needed.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 6: Commit** "Let people export their data, clear social history and delete their account".

---

### Task 8: Honest product surface — boundaries, friendly errors, owner content, helpers, dead code, toggle bug

Audit: Mediums "developer setup errors shown to users", "no error boundaries", "sign-in check copied 17 times", "'always include' toggle does nothing", and "India, INR and the owner's details" (owner-content part only); Lows "dead files", "isMissingTable/validId".

**Files:**
- Create `app/error.tsx` (client; friendly message, Try again, and a link home), `app/global-error.tsx`, and `app/loading.tsx` (Field skeleton).
- Create `lib/auth/session.ts`: `requireUser(): Promise<{ supabase; userId; claims } | null>`, implementing the `getClaims` plus `isAppUnlocked` gate. Replace the local `authed()`/`authenticatedClient()`/`authenticatedUser()` copies in every action file not on the do-not-edit list:
  - `app/ask/actions.ts` only if present in this branch
  - `app/home/brief-actions.ts`, `app/social/actions.ts`, `app/health/steps-actions.ts`, `app/health/library-actions.ts`, `app/invest/actions.ts`, `app/invest/ai-actions.ts`, `app/personal/notification-actions.ts`, `app/ai/result-actions.ts`, `app/finance/actions.ts`
  - the Task 3 and Task 7 routes
  - Move `getAuthenticatedUserId` out of `lib/gmail/oauth.ts` into `lib/auth/session.ts` and re-export it from the old place for compatibility.
- Create `lib/supabase/errors.ts` (`isMissingTable`) and `lib/validate/id.ts` (strict UUID `isUuid`). Replace the copies in editable files.
- Create `lib/validate/id.test.ts`: the strict UUID accepts a v4 and rejects 36 dashes.
- Modify the user-visible developer messages:
  - `lib/providers/status.ts:95,103`
  - `app/health/actions.ts:196-197`: remove the stale `OPENROUTER_API_KEY` requirement entirely, because the router decides availability
  - `components/orbis-app.tsx:234`
  - Replace each with plain copy ("This connection isn't available right now.") and `console.error` the detail server-side.
  - Grep for other offenders: `grep -rn "migration\|Supabase\|_API_KEY\|env" app components lib --include=*.tsx --include=*.ts` in string literals shown to users, in editable files.
- Modify `lib/personal/fitness-persona.ts`: remove the owner's personal starter content ("2021 plan… 92 kg"), replacing it with a neutral example prompt.
- Modify `components/orbis-app.tsx:146`: the avatar fallback becomes a user icon, not "G".
- Modify `app/health/library-actions.ts:45-49`: `setHealthDocumentAlwaysAction` updates through the admin client scoped by `user_id` (the same pattern as other health-document writes in `lib/health-docs/repository.ts`), and reports failure when no row changed.
- Delete `lib/ai/openrouter.ts`, `lib/providers/crypto.ts`, `public/brands/zerodha.svg`, and `LockButton`/`useLockApp` from `components/security/app-lock-guard.tsx`. Remove `COINGECKO_API_KEY` from `.env.example`. Before each deletion, `grep -rn` the symbol to confirm there are no references.

**Interfaces:**
- Consumes: `UserFacingError` (Task 4).
- Produces: `requireUser`, `isMissingTable`, `isUuid`.

- [ ] **Step 1: Failing test** for `isUuid`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isUuid } from './id';

test('accepts a real uuid and rejects look-alikes', () => {
  assert.equal(isUuid('3f2b8a4e-9c1d-4e7a-8b2f-1a2b3c4d5e6f'), true);
  assert.equal(isUuid('-'.repeat(36)), false);
  assert.equal(isUuid('3f2b8a4e9c1d4e7a8b2f1a2b3c4d5e6f'), false);
  assert.equal(isUuid(42), false);
});
```

- [ ] **Step 2: Run it.** Expected: FAIL. Then implement it and run again. Expected: PASS.
- [ ] **Step 3: Boundaries, helpers, message cleanup, owner content, toggle fix and deletions** as described under Files, one file at a time. After the helper refactor, `grep -rn "async function authed\|authenticatedClient\|authenticatedUser" app` should only find files on the do-not-edit list.
- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:public`.
- [ ] **Step 5: Commit** "Honest surface: error boundaries, friendly errors, one sign-in gate, no owner content, dead code removed".

---

### Task 9: AI consent and an "AI off" switch, enforced in the router

Audit: H10.

**Files:**
- Create `supabase/migrations/202609280202_ai_consent.sql`, or `…0203` if Task 7 used `0202`: `alter table public.ai_preferences add column if not exists ai_enabled boolean not null default false, add column if not exists ai_consented_at timestamptz;`. Read the `ai_preferences` migration first to match its grants and RLS.
- Create `lib/ai/consent.ts`: a pure `aiAllowed(prefs: { aiEnabled: boolean; aiConsentedAt: string | null }): boolean`, tested, plus a server-only `getAiConsent(userId)` that reads with the admin client.
- Create `lib/ai/consent.test.ts`.
- Modify `lib/ai/router.ts`: before choosing candidates, `if (!aiAllowed(await getAiConsent(request.userId))) return null;`. Add `export const AI_OFF_MESSAGE = 'AI features are off. Turn them on in Profile → Settings → AI.'` in `lib/ai/consent.ts`.
- Modify `lib/ai/preferences.ts`: add `aiEnabled`, `aiConsentedAt` to `AiPreferences` and `setAiEnabled(userId, enabled)`. Turning it on stamps `ai_consented_at = now()` the first time.
- Modify `components/personal/home-brief-setting.tsx`, or create `components/personal/ai-consent.tsx` rendered beside it (whichever is not on the do-not-edit list). It shows an "Use AI features" switch with the disclosure:
  - which data each feature sends: brief (summary numbers), Ask (the sources you tick), health plans (your documents' passages), social drafts (your brief)
  - the providers
  - that personal data only goes to providers that do not train on it
  - Home brief's existing toggle stays and only matters when AI is on.
- Modify the AI actions in editable files so a null result caused by consent returns `AI_OFF_MESSAGE` instead of "No AI model is available": `app/social/actions.ts`, `app/health/actions.ts`, `app/health/library-actions.ts`, `app/invest/ai-actions.ts`, `app/home/brief-actions.ts` / `lib/home/brief-service.ts`. Check `aiAllowed` before calling the router, and before any quota is consumed, so the check doesn't use up quota.

**Interfaces:**
- Consumes: `requireUser` (Task 8).
- Produces: `aiAllowed`, `getAiConsent`, `AI_OFF_MESSAGE`, `setAiEnabled`.

- [ ] **Step 1: Failing test:**

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { aiAllowed } from './consent';

test('AI is off until the person turns it on', () => {
  assert.equal(aiAllowed({ aiEnabled: false, aiConsentedAt: null }), false);
});
test('turning it on without the consent stamp is not enough', () => {
  assert.equal(aiAllowed({ aiEnabled: true, aiConsentedAt: null }), false);
});
test('on and consented means allowed; switching off stops it again', () => {
  assert.equal(aiAllowed({ aiEnabled: true, aiConsentedAt: '2026-09-28T10:00:00Z' }), true);
  assert.equal(aiAllowed({ aiEnabled: false, aiConsentedAt: '2026-09-28T10:00:00Z' }), false);
});
```

- [ ] **Step 2: Run it.** Expected: FAIL. Implement, then PASS.
- [ ] **Step 3: Migration, router gate, preferences, UI and action messages** as described under Files. The consent module is pure, so `lib/ai/consent.ts` holds only `aiAllowed` and `AI_OFF_MESSAGE`. Put the server read in `lib/ai/consent-store.ts` (server-only).
- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 5: Commit** "Ask before any AI feature runs, and let people turn AI off".

---

### Task 10: PWA — service worker on every load, offline page, app-shell caching, richer manifest

Audit: the Medium "service worker has no offline fallback"; the Lows "manifest" and "blurred background blobs and a preloaded hidden logo".

**Files:**
- Create `components/pwa/register-sw.tsx`: a client component that registers `/sw.js` once on load, in production only. Render it in `app/layout.tsx`.
- Modify `components/personal/notification-settings.tsx`: use the existing registration (`navigator.serviceWorker.ready`) instead of registering its own.
- Create `app/offline/page.tsx`: static, uses `PublicShell` from Task 6, with the copy "You're offline. Orbis will pick up where you left off when you're back."
- Modify `public/sw.js`:
  - `install`: precache `/offline`, `/icon.png`, `/apple-icon.png`, `/manifest.webmanifest`
  - `activate`: clean old caches (versioned `CACHE = 'orbis-v1'`)
  - `fetch`:
    - navigations are network-first, falling back to the cached `/offline`
    - `/_next/static/*` is cache-first (immutable)
    - everything else, including `/api/*` and Supabase, passes through untouched
  - Keep the existing `push` and `notificationclick` handlers exactly.
- Create `lib/pwa/sw-routing.ts` and `lib/pwa/sw-routing.test.ts`: a pure `strategyFor(request: { mode: string; url: string; method: string }, origin: string): 'network-first-offline' | 'cache-first' | 'passthrough'`, tested. `sw.js` inlines the same rules; add a comment pointing at the tested module.
- Modify `app/manifest.ts`:
  - `categories: ['finance', 'health', 'productivity', 'lifestyle']`
  - `shortcuts` (Expense `/#finance`, Health `/#health`, Social `/#social`)
  - `theme_color` and `background_color` matching `app/layout.tsx` light `themeColor`
  - remove `orientation`
- Modify `app/globals.css`: `.ambient { display: none; }` inside the phone media query.
- Modify `components/brand/orbis-mark.tsx`: drop `priority`.
- Create `tests/e2e/public/pwa.spec.ts`.

**Interfaces:**
- Consumes: `PublicShell` (Task 6).
- Produces: `strategyFor`.

- [ ] **Step 1: Failing tests:**

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { strategyFor } from './sw-routing';

const origin = 'https://orbis.app';
test('page navigations fall back to the offline page', () => {
  assert.equal(strategyFor({ mode: 'navigate', url: 'https://orbis.app/', method: 'GET' }, origin), 'network-first-offline');
});
test('hashed static assets are cache-first', () => {
  assert.equal(strategyFor({ mode: 'no-cors', url: 'https://orbis.app/_next/static/chunks/a1b2.js', method: 'GET' }, origin), 'cache-first');
});
test('API calls, other origins and non-GETs are never cached', () => {
  assert.equal(strategyFor({ mode: 'cors', url: 'https://orbis.app/api/home/brief', method: 'GET' }, origin), 'passthrough');
  assert.equal(strategyFor({ mode: 'cors', url: 'https://proj.supabase.co/rest/v1/x', method: 'GET' }, origin), 'passthrough');
  assert.equal(strategyFor({ mode: 'navigate', url: 'https://orbis.app/', method: 'POST' }, origin), 'passthrough');
});
```

```ts
// tests/e2e/public/pwa.spec.ts
import { expect, test } from '@playwright/test';

test('manifest is installable and the offline page renders', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose?.includes('maskable'))).toBe(true);
  expect(manifest.shortcuts.length).toBeGreaterThan(0);
  const response = await page.goto('/offline');
  expect(response!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/offline/i);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** everything described under Files.
- [ ] **Step 4: Run them.** Expected: PASS. The Task 2 headers spec must still pass: `worker-src` and the service worker must not trigger CSP violations.
- [ ] **Step 5: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:public`.
- [ ] **Step 6: Commit** "Installable app: service worker on every load, offline page, cached shell, richer manifest".

---

### Task 11: README and environment docs

Audit: the Medium "README is out of date".

**Files:**
- Modify `README.md`: a full rewrite.
  - what Orbis is (positioning line)
  - features by tab
  - architecture sketch: App Router single shell, Supabase RLS, server actions, AI router with sensitivity, proxy CSP
  - local setup (`pnpm install`, copy `.env.example`, required vs optional vars)
  - migrations (apply `supabase/migrations` in order, or the `pending.sql` bundle; list the new Phase 1 migrations)
  - scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `test:public`, `test:e2e` with the warning that it creates users in the configured project)
  - deploy (Vercel env vars, cron, region pinning)
  - a security model summary
  - links to `AUDIT_REPORT.md` and the roadmap
- Modify `.env.example`: every variable the code reads (grep `process.env\.` across `app lib components proxy.ts next.config.ts`), grouped Required / Optional with one-line comments. Add `NEXT_PUBLIC_SUPPORT_EMAIL`. `COINGECKO_API_KEY` was removed in Task 8.
- Create `docs/phase-1-owner-actions.md`: a checklist of what only the owner can do:
  - set `ORBIS_ALLOWED_EMAILS` (or deliberately open sign-up)
  - apply migrations `202609280200+`
  - in Supabase, enable Secure password change and Leaked password protection
  - set `NEXT_PUBLIC_SUPPORT_EMAIL`
  - review the privacy and terms text
  - pin the Vercel function region to the Supabase region
  - check Supabase users for unknown accounts

**Interfaces:**
- Consumes: every earlier task's names.

- [ ] **Step 1: Check for missing vars.** Run `grep -rhoE "process\.env\.[A-Z_]+" app lib components proxy.ts next.config.ts | sort -u` and diff it against `.env.example`. Every name must appear in `.env.example`.
- [ ] **Step 2: Write** the README, `.env.example` and the owner-actions doc.
- [ ] **Step 3: Re-run** the Step 1 check. Expected: no missing names. Then `pnpm lint`.
- [ ] **Step 4: Commit** "Rewrite the README and environment docs for Phase 1".
