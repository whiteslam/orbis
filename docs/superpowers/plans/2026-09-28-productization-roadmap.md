# Orbis Productization Roadmap

Source: `AUDIT_REPORT.md` (2026-09-28, overall 52/100). This file groups every finding into phases. Each phase gets its own implementation plan when it starts. Phase 1's plan is `2026-09-28-phase-1-foundation.md`.

## Phase 1 — Foundation: safe, fast and honest (this branch)

Everything that can be done in code, with no new external accounts, so that the app is safe to open to strangers and feels fast. Target: overall score about 75.

1. Tooling: one green `pnpm test`, working `pnpm lint`, pinned versions, CI workflow.
2. Security headers and a nonce-based Content Security Policy.
3. Performance quick wins:
   - no double renders
   - the AI brief is requested once
   - tabs load on demand
   - background reads move off server actions
   - fewer queries per render
4. Auth and data hardening:
   - password change needs re-authentication
   - generic sign-in errors and stronger passwords
   - Zerodha OAuth state
   - push-endpoint allowlist and grants
   - AI router allowlists
   - PIN function search path
5. Rate limits, storage caps, and signed direct uploads for health documents and workbooks (fixes the 4.5 MB Vercel limit).
6. Public pages:
   - landing page
   - privacy, terms, support and delete-account pages
   - robots, sitemap, metadata and share previews
7. Account deletion, data export, and social history purge.
8. Honest product surface:
   - error and loading boundaries
   - friendly errors instead of developer setup messages
   - owner-specific content removed
   - shared helpers
   - dead code removed
   - the health-document toggle bug fixed
9. AI consent step and an "AI off" switch, enforced in the router.
10. PWA: the service worker always registers, offline page, app-shell caching, a richer manifest.
11. README and `.env.example` rewritten.

**Owner actions that go with Phase 1** (the code cannot do these):
- Set `ORBIS_ALLOWED_EMAILS` in Vercel.
- Enable Supabase "Secure password change" and "Leaked password protection".
- Apply the new migrations.
- Set `NEXT_PUBLIC_SUPPORT_EMAIL` and review the legal text.
- Pin the Vercel function region to the Supabase region.

## Phase 2 — Store launch

- Real route segments (`/finance`, `/health`, …) with per-route data, `'use cache'` and cache tags.
- A responsive desktop layout.
- Five tabs, with Social as an optional module.
- Onboarding: name, time zone, modules, first source, lock.
- Per-user time zone, currency and locale (replacing hard-coded IST/INR).
- One money formatter.
- Capacitor (iOS) and a TWA or Capacitor (Android), with:
  - native push
  - HealthKit and Health Connect
  - biometric unlock
  - the share sheet
  - `assetlinks.json` and `apple-app-site-association`
- Holdings import from CAS statements or CSV.
- Expense import from statements, or a per-user forwarding address.
- Queued notification dispatch and background Gmail sync.
- Sentry and privacy-safe analytics.
- Store assets and Data safety / privacy-label declarations.
- A staging Supabase project and Supabase CLI migrations.

## Phase 3 — Paid

- Plans and entitlements tables, with daily caps read from the plan.
- Razorpay or Stripe on the web, and RevenueCat (IAP / Play Billing) in the apps.
- Premium features:
  - weekly and monthly reviews
  - unlimited Ask Orbis
  - the health plan builder
  - portfolio insights
- Direct broker APIs, once commercial terms with Zerodha and Groww are signed.
- Google OAuth verification plus CASA for Gmail, started during Phase 2 because it runs on calendar time.
- Paid AI tiers under a no-training data-processing agreement.
- Vercel Pro and a paid Supabase plan with point-in-time recovery.
