# Project Audit Report — Orbis

**Date:** 2026-09-28 · **Stack:** Next.js 16.3 (App Router) · React 19 · TypeScript (strict) · Supabase (Postgres, RLS, Storage, Auth) · Vercel · **Scope:** the whole repository at `main` (cb1567a), plus another session's uncommitted work in the tree. Production was reached only through public GET requests. One production build was measured. There was no signed-in Lighthouse run, no e2e run, and no access to the Supabase or Vercel dashboards.

The dashboard version of this report is `audit-report.html` (open it in a browser). The findings in `audit.json` feed it.

## Scorecard

| Axis | Score | Grade | Summary |
|---|---|---|---|
| Security | 42/100 | F | No criticals. 1 high: public sign-up is open on the live site. 5 medium: no security headers, password change without re-auth, push-endpoint SSRF, no upload limits, no account deletion. |
| Performance | 42/100 | F | 392 KB gzip of JS on first load with every tab bundled. Home renders 2–3 times per open. Nothing is cached. |
| SEO / store readiness | 58/100 | F | Only the auth pages are public. No privacy policy, landing page, robots, sitemap or share previews. |
| Code quality | 78/100 | C | Strict TypeScript and 1.4% duplication, but `pnpm test` always fails, the lint script is broken, and there is no CI. |
| **Overall** | **52/100** | **F** | Security×0.35 + Performance×0.25 + SEO×0.20 + Code quality×0.20. No critical finding, so no cap. |

The scores measure how ready this is to put in front of strangers, not how well it's built. Underneath, it is careful work.

## Executive summary

Orbis is better engineered than most apps at this stage:
- Every table has row-level security.
- Connection tokens are encrypted with AES-GCM.
- An AI router only lets personal data reach providers that don't train on it.
- The app has an honest PIN and passkey lock, strict TypeScript, and friendly error handling throughout.

What stands between it and a product people pay for is mostly around the code rather than in it:
1. **Anyone can sign up on the live site today.** The email allowlist is off in production. Fixing it is a five-minute setting.
2. **Both app stores need things that don't exist yet:** a privacy policy, account deletion, a consent screen for AI data sharing, and a native layer beyond a wrapped website.
3. **Some features can't be offered to strangers yet.** Gmail and the broker connections need Google's verification or the brokers' commercial terms first.
4. **It feels slower than it should.** Every open renders Home two or three times and downloads every tab.

The quick wins take one to two days and move the overall score to about 70. Store launch and billing take a few weeks. Google's Gmail verification takes calendar time and money you don't control.

## High priority

### H1. Anyone can create an account on the live site
- **Where:** `lib/security/access.ts`. Production `/login` serves `"signupOpen":true`.
- **Impact:** strangers can store financial and health data with no privacy policy, no terms, no deletion and no upload limits. They also share your free AI and market-data quotas.
- **Fix:** set `ORBIS_ALLOWED_EMAILS=<your address>` in Vercel (Production) and redeploy. Reopen sign-up on purpose once H6–H8 and M4 are done.
- **Also required:** check Supabase → Authentication → Users for accounts you don't recognise.

### H2. Home renders the whole page twice on every open
- **Where:** `components/orbis-app.tsx:515`
- **Impact:** `router.refresh()` runs on mount and on every return from background. That re-runs about 34 database calls. You get visible jank and double the load.
- **Fix:** skip the refresh on first mount, and refresh on visibility only after 60 s or more hidden.

### H3. Every save renders the full page twice
- **Where:** 54 `revalidatePath('/')` calls, plus 33 `router.refresh()` calls that run right after them (for example `components/orbis-app.tsx:201`).
- **Impact:** one journal save costs about 68 database round-trips and two full payloads.
- **Fix:** keep `revalidatePath` and delete the follow-up `router.refresh()` calls. Later, use per-slice `'use cache'` + `cacheTag`.

### H4. Background Home requests make the user's taps wait
- **Where:** `components/orbis-app.tsx:95`
- **Impact:** Next runs server actions one at a time per client. The portfolio fetch and the AI brief (up to 20 s) queue ahead of the user's Done, Save and Sync taps.
- **Fix:** turn these two reads into GET route handlers, or stream them server-side inside `<Suspense>`.

### H5. The AI brief is generated 2–3 times per open
- **Where:** `components/orbis-app.tsx:123`, `lib/home/ai-brief.ts:113`
- **Impact:** it fires before the weather arrives, again after, and again when the portfolio lands. The limit of 12 a day is gone after about five opens.
- **Fix:** ask once, after weather and portfolio have settled.

### H6. No code splitting
- **Where:** `components/orbis-app.tsx:24`
- **Impact:** 392 KB gzip (1.47 MB raw) of JS before Home is usable on a mid-range Android.
- **Fix:**
```tsx
- import { InvestDashboard } from '@/components/invest/invest-dashboard';
+ const InvestDashboard = dynamic(() => import('@/components/invest/invest-dashboard').then((m) => m.InvestDashboard));
```
  Do the same for Finance, Health, Social, Profile and the recharts chart. Expected result: about 200–230 KB gzip.

### H7. No privacy policy
- **Where:** there is no `/privacy` route; it returns 404 live.
- **Impact:** both stores, Google OAuth verification, India's DPDP Act and GDPR all require one.
- **Fix:** add `app/privacy/page.tsx`. Cover the data collected, why, the processors (Supabase, Vercel, Google, Zerodha, Groww, the AI providers, weather and market APIs), retention, deletion and a grievance contact.
- **Also required:** you approve the legal text, ideally after a lawyer's review.

### H8. No account deletion or data export
- **Where:** Profile → Account only has Sign out (`components/personal/profile-screen.tsx:208-211`). Nothing calls `deleteUser`.
- **Impact:** this blocks both stores (Play account-deletion policy, Apple 5.1.1(v)) and DPDP/GDPR erasure. History tables also keep deleted journal text forever.
- **Fix:** add `deleteAccountAction`. It should require a fresh password or passkey, revoke the Gmail, Zerodha and Groww connections, remove the user's folders in every bucket, then call `auth.admin.deleteUser` (the database cascade removes the rows). Also add a public `/delete-account` page, a "purge history" option and a JSON/ZIP export.

### H9. Gmail read access needs Google verification and a yearly security assessment
- **Where:** `lib/gmail/oauth.ts:77-78` (`gmail.readonly`, `calendar.readonly`)
- **Impact:** until Google verifies the app, including a paid yearly CASA assessment, it is capped at 100 test users and tokens expire every 7 days.
- **Fix:** keep Gmail as an opt-in beta. For v1, lead with statement or CSV import, a per-user forwarding address, SMS parsing on Android, or India's Account Aggregator network. Drop `calendar.readonly` if nothing uses it.
- **Also required:** start verification. It needs a custom domain, a homepage and H7.

### H10. Personal data goes to third-party AI without a consent screen
- **Impact:** Apple 5.1.2(i) and Play's Data safety form both require disclosure and consent.
- **Fix:** add a one-time consent screen that names the providers and data types, plus an "AI off" switch. List the providers in the privacy policy.

### H11. Broker connections are built for one owner
- **Where:** `lib/invest/groww.ts:36` (`GROWW_OWNER_EMAIL`) and `lib/invest/zerodha.ts:26` (one server-wide Kite key)
- **Fix:** for v1, import holdings from CAS statements (CAMS/KFintech) or CSV. Hide direct broker links for other users until the commercial terms are agreed.
- **Also required:** ask Zerodha and Groww about terms for multi-user and commercial API use.

### H12. A wrapped website risks App Store rejection (guideline 4.2)
- **Fix:** wrap it with Capacitor (iOS) and a Trusted Web Activity or Capacitor (Android). Add native value:
  - native push (web push doesn't work inside an iOS WebView)
  - HealthKit and Health Connect in place of the manual export upload
  - Face ID and fingerprint unlock
  - the share sheet for Social
  - widgets

### H13. No Digital Asset Links file for an Android TWA
- **Fix:** add `public/.well-known/assetlinks.json` with the package name and the Play signing SHA-256, including `get_login_creds` so passkeys work.

### H14. `pnpm test` always fails
- **Where:** `vitest.config.ts`. 13 of the 18 test files use `node:test`.
- **Impact:** no single command runs all 143 cases green, so nothing can gate a release.
- **Fix:** convert those files to vitest and add coverage.

### H15. No linter or formatter; the `lint` script is broken
- **Fix:** run `npx @next/codemod@canary next-lint-to-eslint-cli .`, add `eslint.config.mjs` (`next/core-web-vitals`, `react-hooks`), and add Prettier or Biome.

### H16. No CI
- **Fix:** add a GitHub Actions workflow that runs `pnpm install --frozen-lockfile`, `tsc --noEmit`, lint, `vitest run --coverage`, `next build` and `pnpm audit --prod --audit-level=high`.

## Medium priority

**Security**
- **No security headers** (`next.config.ts:3-10`). Add CSP with `frame-ancestors 'none'` and a nonce for the inline theme script, plus HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`. Set `poweredByHeader: false`.
- **Password change needs no re-authentication and works while the app is locked** (`app/auth/actions.ts:132-146`). Require a fresh recovery sign-in, or the current password plus an unlocked app. In Supabase, enable "Secure password change" and "Leaked password protection". The PIN lock guards server actions, not the data API, so either say so in the UI or enforce the lock in RLS.
- **Push endpoints can point anywhere** (migration `…0015`, `lib/notifications/push.ts`). Add a CHECK that limits hosts to real push services, revoke direct INSERT and UPDATE, add a 5 s timeout and bounded concurrency, and narrow the `notification_log` grants.
- **No rate limits or storage quotas** on uploads, parsing and sync. Add a per-user token bucket, document and byte caps, and signed direct uploads.

**Performance**
- **Uploads over about 4.5 MB fail on Vercel.** The server-action body limit is set to 101 MB, but Vercel won't accept it. Switch to signed direct uploads.
- **About 34 uncached calls per render, running in the US region** while users and data are in India. Pin the functions to the Supabase region, fold `getPinStatus` into the `Promise.all`, and share one connections loader.
- **Every tab's data rides along with Home.** Give each tab its own route and loader, and send plan summaries instead of full plan JSON.
- **Nothing is cached:** broker holdings are fetched on every Home visit and there is no offline app shell. Add `'use cache'` + `cacheTag`, a 60–120 s holdings cache, and service-worker shell caching.
- **The AI router has no overall deadline.** The worst case exceeds the 60 s function limit. Share one budget across attempts, and log with `after()`.
- **A wasted Zerodha query runs on every render** (`lib/providers/status.ts:125`).

**Store and SEO**
- There are no terms of service or support page, and no public landing page (the root redirects to `/login`).
- The service worker has no offline fallback and only registers when notifications are turned on.
- Passkeys in a native wrapper need `apple-app-site-association`.
- There is no billing path that meets store rules. Add plans and entitlements, Razorpay or Stripe on the web, and RevenueCat in the apps.
- Health features need store declarations and medical disclaimers.
- The UI uses third-party logos and trademarks (Groww logo, "Apple Health" and "Gmail" labels).

**Code quality and product**
- **The sign-in and lock check is hand-copied about 17 times.** Replace the copies with `lib/auth/session.ts` → `requireUser()`.
- **India, INR and the owner's own details are hard-coded:** `Asia/Kolkata` appears in 34 files, the fitness starter is the owner's 92 kg plan, and the avatar falls back to "G". Add `lib/time/zone.ts` and store time zone, currency and locale per user.
- **Users see developer setup errors and there is no onboarding.** For example: "Apply the Zerodha connections migration…". Show friendly messages, log the details on the server, and add a 3–4 step onboarding.
- **There is no error monitoring and no `error.tsx`, `global-error.tsx` or `loading.tsx`.** Add Sentry and the boundaries.
- **One 626-line client component holds every tab in state.** Move to route segments.
- **There are five money formatters with four rounding rules.** Replace them with `lib/format/money.ts`.
- **The riskiest code has no tests:** the bank-alert parser, the workbook limits, the AI router's sensitivity gate and the crypto.
- **Bug:** the "always include" toggle for health documents silently does nothing (`app/health/library-actions.ts:45-49`), because there is no UPDATE policy on that table.
- **The README is out of date.** It describes removed features and 12 of the 30 migrations, and misses 19 env vars.

## Low priority / polish

- Zerodha's connect flow has no state/CSRF check. Copy Gmail's signed-state pattern.
- The owner's Groww keys are granted by matching an email address. Remove that, or bind it to a user id.
- Sign-in messages reveal whether an account exists, and the only password rule is 8 characters.
- Table grants rely on Supabase defaults. Revoke all, then grant exactly what's needed.
- `consume_app_pin_attempt` has a mutable `search_path`.
- The AI router trusts the database to say which secret to send, and where to send it. Allowlist env var names and hosts in code.
- The e2e tests use the production service key and create users in production. Use a separate project.
- Raw error messages are echoed to the browser in a few actions.
- Dependencies are pinned to `latest`, and there's a moderate `uuid` advisory (via exceljs).
- Home content jumps as the brief, weather and portfolio arrive.
- A 132 KB global stylesheet loads on every page.
- Blurred background blobs and a preloaded hidden logo still render on phones.
- Social images use full-resolution `<img>`.
- There's no robots.txt or sitemap, titles are short, the description is shared, and there's no canonical URL, OG tags or JSON-LD.
- The manifest has no screenshots, categories or shortcuts, and its theme colours don't match the app.
- Dead files and exports (see below). Unused tables are still in the schema. The workbook AI quota is shared by unrelated features. The dark-theme tokens are written twice. Many lines run past 200 characters.

## Store readiness checklist

| Requirement | Google Play | App Store | In the repo | What to build |
|---|---|---|---|---|
| Public privacy-policy URL | Required | Required | Missing | `/privacy` |
| In-app account deletion | Required | Required (5.1.1v) | Missing | Delete-account action + button |
| Web deletion URL | Required | – | Missing | `/delete-account` |
| Terms, support URL, contact | Contact required | Support URL required | Missing | `/terms`, `/support` |
| Data export | Recommended | Recommended | Missing | ZIP/JSON export |
| Digital Asset Links | Required for TWA | – | Missing | `.well-known/assetlinks.json` |
| Associated Domains (passkeys, links) | – | Needed | Missing | `apple-app-site-association` |
| Native project | Bubblewrap/Capacitor | Xcode/Capacitor | Missing | Wrapper projects |
| Native value (guideline 4.2) | Moderate risk | High risk | Web-only features | Native push, HealthKit/Health Connect, biometrics, share sheet, widgets |
| Push inside the app | Works via Chrome in a TWA | Web Push not in WKWebView | Web Push only | Capacitor push (APNs/FCM) |
| Offline fallback | Quality bar | Expected | Missing | Service-worker fetch handler + `/offline` |
| Sign in with Apple | – | Only if a third-party login is added | Not needed today | Add it if Google sign-in comes |
| Tracking / ATT | Data safety | ATT | No trackers found | Declare "no tracking" |
| Data safety / privacy labels | Required | Required | No inputs yet | Declare email, financial, health, fitness, location, audio, user content, calendar, push token; shared with AI providers |
| AI data-sharing consent | "Shared" | 5.1.2(i) | Missing | Consent screen |
| Health data rules | Health apps declaration | 1.4.1, HealthKit rules | Partial | Disclaimers, permissions |
| Financial features declaration | Required | Scrutiny | Partial | Declaration; fix single-owner brokers |
| Gmail restricted-scope verification | Needed | Needed | Not started | Verification + CASA, or a non-Gmail import |
| Billing for digital subscriptions | Play Billing | IAP (3.1.1) | None | RevenueCat / native IAP |
| Store assets | 512 icon, feature graphic, screenshots | 1024 icon, screenshots | 512 icons only | Generate them |

## Duplicate code & merge plan

jscpd measured 1.43% duplication (305 of 21,261 lines). That is low. The copies that matter are short helpers, and they're found by grep rather than by jscpd.

| Cluster | Files | Lines dup. | Proposed home | Notes |
|---|---|---|---|---|
| Sign-in + app-lock gate | ~17 action files + `lib/gmail/oauth.ts` | ~100 | `lib/auth/session.ts` → `requireUser()` | Security-critical; three different names today |
| India time-zone helpers | 14 files, 7+ "today" helpers | ~60 | `lib/time/zone.ts` (tz as a parameter) | Merge first, then add a per-user time zone |
| Money formatting | 5–6 files | ~30 | `lib/format/money.ts` | Four rounding rules today |
| `isMissingTable` | 12 files | ~12 | `lib/supabase/errors.ts` | Social's copy is already exported |
| `validId` | 4 action files | 4 | `lib/validate/id.ts` (strict UUID) | Loose and strict versions differ |
| Dark-theme tokens | `globals.css`, `atlas-social.css` | 81 | `light-dark()` tokens | Each theme is written twice |

For each cluster, the shared module survives and the call sites import it. The only behaviour change is in `validId`: the loose version currently accepts 36 dashes, and the strict one won't. That is the correct change.

## Dead code

- `lib/ai/openrouter.ts`: nothing imports it (confirmed).
- `lib/providers/crypto.ts`: nothing imports it (confirmed). `COINGECKO_API_KEY` in `.env.example` serves nothing.
- `LockButton` / `useLockApp` in `components/security/app-lock-guard.tsx`: they only reference each other (confirmed).
- `public/brands/zerodha.svg`: not referenced (confirmed).
- Tables `goals`, `habits`, `habit_checkins`, `investment_holdings`: no code references them (confirmed). They are likely still in the live schema.
- About 26 unused exports and 14 unused exported types (knip). Several only need un-exporting.

All dependencies in `package.json` are in use.

## SEO breakdown

| Category | Score | Notes |
|---|---|---|
| Crawlability & indexing | 12/25 | Server-rendered auth pages; no robots, sitemap or canonical |
| On-page metadata | 15/25 | Titles are short (15–23 characters); one shared 55-character description |
| Social & structured data | 0/15 | No OG, Twitter card or JSON-LD |
| Content quality | 13/15 | Correct decorative alt text; no header, footer or nav landmarks |
| Technical & CWV | 18/20 | HTTPS + HSTS preload; LCP and CLS estimated |

Only `/login` and `/forgot-password` are indexable, and neither is worth ranking. SEO starts to matter once there is a landing page, and it should become the one indexable page.

## What's new — modernization

- `next lint` was removed in Next 16. Migrate to the ESLint CLI with a flat config.
- `latest` is used as the version pin for next, react, recharts, lucide-react, TypeScript and @types. The installed versions are next 16.3.6, react 19.3.0 and TypeScript 7.0.2. Pin them, and add `packageManager` and `engines` (Node ≥ 22).
- The tests are split between two runners, so standardise on vitest.
- Route segments with `'use cache'` + `cacheTag`/`updateTag` are the Next 16 way to load and refresh per-tab data.
- CSS `light-dark()` replaces duplicated theme blocks.
- Add `.gitattributes` to stop the LF/CRLF warnings.

## Prioritized action list

| # | Action | Axis | Impact | Effort | Score gain |
|---|---|---|---|---|---|
| 1 | Set `ORBIS_ALLOWED_EMAILS` in Vercel | Security | Critical | 5 min | +15 |
| 2 | Stop the double renders (mount refresh; `router.refresh` after actions) | Perf | High | 1–2 hrs | +10 |
| 3 | Ask for the AI brief once, after weather and portfolio settle | Perf | High | 1 hr | quota, latency |
| 4 | Security headers + `poweredByHeader: false` | Security | Medium | 2 hrs | +6 |
| 5 | Pin functions to the Supabase region | Perf | Medium | 15 min | TTFB |
| 6 | `next/dynamic` for every non-Home tab and the charts | Perf | High | 2 hrs | +15 |
| 7 | Re-auth for password change; Supabase secure password change | Security | Medium | 2 hrs | +6 |
| 8 | Lock down push subscriptions and notification-log grants | Security | Medium | 1 hr | +6 |
| 9 | Privacy, terms, support and landing pages + robots, sitemap, OG | SEO/store | High | 1–2 days | +25 SEO |
| 10 | Account deletion, history purge, data export | Store/security | High | 1–2 days | +6 |
| 11 | vitest everywhere, ESLint/Prettier, GitHub Actions CI | Code quality | High | 1 day | +13 |
| 12 | `requireUser`, time-zone and money helpers | Code quality | Medium | 1 day | safety |
| 13 | Rate limits, quotas, signed direct uploads | Security/perf | Medium | 1–2 days | +6 |
| 14 | Onboarding, friendly errors, Sentry, error boundaries | Product | High | 2–3 days | premium feel |
| 15 | Route segments with per-route data and caching | Perf/code quality | High | 3–5 days | +16 |
| 16 | Capacitor/TWA with native push, HealthKit/Health Connect, biometrics | Store | High | 2–3 weeks | store launch |
| 17 | Gmail verification + CASA, or a non-Gmail expense import | Product | High | weeks + external cost | sellable Expense |
| 18 | Plans, entitlements, billing | Product | High | 1–2 weeks | revenue |

Estimated scores after actions 1–15: Security about 85, Performance about 75, SEO about 85, Code quality about 95. Overall about 84 (B).

## Suggestions — making it premium and sellable

**Positioning.** The thing that is genuinely different is *one calm daily brief across money, health and routines, with AI that does not train on your data*. Lead with that. The Social planner, workbook advice and voice journal are extras, not the product.

**Three ways to take it to market**
1. **India-first daily brief app, Play Store first (recommended).** The code already assumes IST and INR, and Indian bank-alert parsing plus CAS import is a real gap. Android is the cheap store to start in. Ship Home, Expense (statement or forwarding import first, Gmail as a beta), Health via Health Connect, routines and journal. Keep holdings on CAS import. Price around ₹99–199 a month or a yearly plan. Cut Social and the workbook advisor from v1.
2. **Open-source core plus a hosted paid tier.** Makes the privacy claim checkable. Self-hosters bring their own Gmail and Kite keys, which avoids most verification exposure. Revenue is smaller and slower.
3. **White-label or licence** to a wealth advisor, insurer or fitness coach. One B2B buyer, and their compliance carries the data agreements. Needs multi-tenant theming and an admin view. A buyer's due diligence will check everything in this report first.

**Premium polish** (where to start in the code)
- **Desktop:** replace the phone mock-up (`components/orbis-app.tsx:604-624`) with a real responsive layout: sidebar plus a 2–3 column dashboard.
- **Navigation:** go back to five tabs (Social as an optional module), and use real routes so the back gesture and deep links work.
- **Lock:** let users choose the idle timeout, prefer passkey or biometric, and skip the PIN when a passkey exists.
- **Empty Home:** a "set up your brief" checklist or sample data instead of "Quiet today".
- **Dialogs:** styled confirmation sheets and undo toasts in place of `window.confirm`. The edit history already makes undo possible.
- **Motion:** haptics and motion on complete and confirm; loading skeletons for every tab; no layout jumps on Home.
- **Trust:** a "What Orbis knows about you" page, fed by `ai_generation_events` and the history tables. Few competitors have one.
- **Background sync:** sync Gmail in the background and show a "last synced" chip on Home.
- **One design system:** a single token file, no legacy aliases, and a component inventory.

**Running it as a business**
- Move from Vercel Hobby, which doesn't allow commercial use, to Pro, and to a paid Supabase plan with backups and point-in-time recovery.
- Separate staging and production projects, with migrations applied by the Supabase CLI instead of pasting into the SQL editor.
- Paid AI tiers with zero-retention or no-training terms in a data-processing agreement. Work out the cost per user.
- Put the notification dispatcher on a queue before you grow; today it handles users one by one inside 50 s.
- Add Sentry, privacy-safe analytics and a support channel.

**Phased roadmap**
- **Phase 0, before any stranger signs up (2–3 weeks):**
  - privacy, terms, consent, deletion and export
  - remove owner-specific hard-codes and add a per-user time zone
  - friendly errors and onboarding
  - Sentry, headers, CI, staging
  - paid hosting and AI tiers
  - signed uploads
  - keep Gmail limited to test users
- **Phase 1, store launch (4–6 weeks):**
  - real routes, desktop layout, skeletons, five tabs
  - TWA or Capacitor with native push, biometrics, HealthKit and Health Connect
  - CAS/CSV import
  - queued notifications
  - store assets and declarations
- **Phase 2, paid (3–4 weeks):**
  - plans and entitlements
  - Razorpay or Stripe on the web, RevenueCat in the apps
  - premium features: weekly and monthly reviews, unlimited Ask, the health plan builder, portfolio insights
  - direct broker APIs once the commercial terms are signed

## Not assessed

- **Core Web Vitals:** no signed-in Lighthouse run. LCP, INP, CLS and TTFB are estimates.
- **Supabase project settings:** applied migrations, email confirmation, auth rate limits, MFA, backups, and whether production RLS matches the migrations.
- **Vercel project settings:** region, env var scoping, plan, and preview protection.
- **The e2e suite and axe accessibility results:** the suite creates users in production, so it was not run.
- **Commercial terms and prices** for Kite Connect, the Groww API and the AI providers. Check these before relying on them.
- **Legal review** of any privacy or terms text.
