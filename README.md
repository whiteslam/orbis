# Orbis

Orbis is a private, single-user personal intelligence app: one phone-frame shell over your finances, health documents, investments, daily routines and social drafts, with an AI layer that only ever sees what you've explicitly turned on.

## Features by tab

- **Today:** setup checklist, the daily brief, heads-ups (things Orbis noticed on its own, each with its next step one tap away), routine check-in, weather, important mail, and quiet rows for everything else. Two widgets show activity rings (steps and 7-day average) and this month's spending.
- **Money:** *Spending* (what you add manually, this month at a glance) and *Investments* (Zerodha and Groww holdings, portfolio charts, optional AI read).
- **Health:** steps from an Apple Health export, plans, documents, advice, "Ask about a file", and your coaching style.
- **Journal:** a daily entry with mood, tags and voice notes, edit history, and saved notes Orbis remembers.
- **Social:** a month-by-month planner for your own posts.
- **Ask Orbis:** the button on every screen. Type or talk (voice in Indian languages when `SARVAM_API_KEY` is set) about your journal, spending, routines and steps.
- **Settings:** from the avatar on any screen. You, Connections (every link read-only), AI & privacy, Notifications, Your day, Security (lock now, change PIN), Your data (export, delete, sign out).

Signed-out visitors get a separate public site: a landing page, `/privacy`, `/terms`, `/support`, `/delete-account`, an offline fallback, `robots.txt`/`sitemap.xml` and a generated share image — all reading the site name and canonical URL from `lib/site.ts`.

## Architecture

- **One shell, App Router.** `components/app-shell.tsx` renders the whole signed-in experience as a single phone-frame client component with a tab switcher; only Today is in the first download, everything else is `next/dynamic`. Tabs and legacy links are defined in `lib/shell/tabs.ts`. Today's own data comes from two route handlers (`/api/home/brief`, `/api/home/portfolio`) rather than server actions, so they can be requested in parallel with a timeout instead of blocking a render. The Glass look (frosted cards, soft wallpaper, Figtree font) lives in `app/styles/glass.css` and `app/styles/glass-dark.css`.
- **Supabase for auth and storage, RLS everywhere.** Every user-owned table is row-level-secured to its owner; server code additionally narrows table grants explicitly (`202609280200_hardening.sql`) so RLS is not the only gate. Every server entry point derives the user from `supabase.auth.getClaims()` plus an app-lock check (`isAppUnlocked`) — never from a value the browser supplies.
- **Server actions, typed results.** Mutations are `'use server'` functions that return `{ success: boolean; message: string; … }`; errors meant for the user are typed copy, everything else becomes a generic message and the real error goes to `console.error`.
- **An AI router with sensitivity, not a hardcoded model.** `lib/ai/router.ts` reads a provider/model registry (`ai_providers`, `ai_models`) and routes `'personal'`-sensitivity requests (the brief, plans, workbook advice, portfolio suggestions) only to a provider the registry marks `may_train = false` — today, Groq. `'general'` requests may also reach OpenRouter, Gemini or Mistral. Nothing reaches any provider until the person turns AI on once in Settings (`ai_preferences.ai_enabled`, migration `202609280203_ai_consent.sql`); until then every AI feature falls back to wording Orbis wrote itself.
- **A nonce-based CSP.** `proxy.ts` (the Next.js proxy/middleware entry point) generates a fresh nonce per request, builds a strict `script-src 'self' 'nonce-…' 'strict-dynamic'` policy in `lib/security/csp.ts`, and forwards it as both a request header (so Next stamps its own scripts) and the response header. Static security headers (`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.ts`.
- **A PWA shell.** A service worker registers on every load in production, caches the app shell, and serves `/offline` when the network is unavailable; the manifest and icons make it installable.

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. `.env.local` is git-ignored; never commit real credentials.

`.env.example` groups variables **Required** (the app won't start, or a core path like sign-in or the app lock breaks without it) and **Optional** (a feature quietly stands down without it — most AI providers, Gmail, Zerodha, Groww, market data, and push notifications are optional). Read the comment above each variable before setting it; several have consequences if changed after the fact (`APP_LOCK_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`/`CREDENTIAL_ENCRYPTION_KEY`).

In the Supabase dashboard, add `http://localhost:3000/auth/callback` to Authentication → URL Configuration → Redirect URLs (and the production callback when you deploy), or sign-up confirmation and password-recovery links won't return to the app.

## Migrations

Apply everything in `supabase/migrations/` in filename order through the SQL Editor, or use the combined `supabase/pending.sql` bundle if one is current for your project state. Every migration is written to be safe to run more than once.

The Phase 1 migrations. Apply **`0201`, `0202` and `0203` before deploying this branch, then `0200` immediately after the deploy**: `0200` removes the browser session's right to add push subscriptions, which the previously deployed code still uses, so applying it first breaks turning on notifications until the new code is live. If you use `supabase db push`, the other in-flight migrations `202609280100`–`202609280103` sort before `0200`, so pushing them after `0200` is applied needs `--include-all`.

| Migration | What it locks down |
| --- | --- |
| `202609280200_hardening.sql` | Narrows table grants to what the app actually uses (RLS was not previously the only gate); adds a push-endpoint host check; hardens a `SECURITY DEFINER` function's search path. |
| `202609280201_rate_limits.sql` | Per-person daily/hourly limits for uploads, file parsing and Gmail sync, plus the `workbook-uploads` storage bucket for signed direct uploads. **Uploads, parsing and Gmail sync are refused until this migration exists** — the checks fail closed, not open. |
| `202609280202_staged_upload_claims.sql` | Makes each signed upload path claimable exactly once, so a reused upload token can't be processed twice. |
| `202609280203_ai_consent.sql` | Adds the one AI on/off switch (`ai_preferences.ai_enabled`, default **false**) that `lib/ai/router.ts` checks before routing any request. **AI features stay off for everyone until this migration exists**, regardless of provider keys. |

See `docs/phase-1-owner-actions.md` for the full pre-deploy checklist these migrations are part of.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Runs the app locally. |
| `pnpm build` | Production build. |
| `pnpm start` | Serves the production build. |
| `pnpm lint` | ESLint (flat config). |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` | Unit tests (Vitest). |
| `pnpm test:public` | Playwright against the signed-out public site only (`playwright.public.config.ts`). |
| `pnpm test:e2e` | Full Playwright suite. **This creates real user accounts in whatever Supabase project your `.env` points at — do not run it against your production project.** |

CI (`.github/workflows/`) runs `typecheck`, `lint`, `test`, `build` and `pnpm audit --prod --audit-level=high` on every push to `main` and every pull request, against placeholder Supabase env values.

TypeScript is pinned to `6.0.3` because `typescript-eslint`'s current release rejects TypeScript 7 (`^6` also happily resolves to a TS7 prerelease under some registries, so the pin is exact, not a caret range).

## Deploy

- Set the **Required** and whichever **Optional** variables you need (see `.env.example`) as server environment variables in your Vercel project. `NEXT_PUBLIC_*` variables are exposed to the browser by design; nothing else should be.
- Set `NEXT_PUBLIC_SITE_URL` to the deployed HTTPS origin and `GOOGLE_REDIRECT_URI` to its Gmail callback; add both to Supabase's and Google's redirect allowlists.
- Apply `0201`–`0203` before the first deploy of this branch (rate limits and uploads fail closed without them), and `0200` immediately after it.
- Pin the Vercel function region to the same region as your Supabase project, to keep server-to-database latency low.
- If you schedule the daily notification (`/api/notifications/dispatch`) with Vercel Cron or an external scheduler, set `CRON_SECRET` and have the scheduler send it.
- See `docs/phase-1-owner-actions.md` for the full checklist, including account-security settings that only exist in the Supabase dashboard and can't be set from code.

## Security model summary

- **Authentication and session.** Supabase email/password and passkey (WebAuthn) sign-in. Every server entry point re-derives the user from `supabase.auth.getClaims()`; nothing trusts a client-supplied user id.
- **App lock.** After 5 minutes idle, or on return from the background, the app locks; the home page renders only the lock screen and every data action refuses to run until it's unlocked with a passkey, password, or a 6-digit device PIN (salted scrypt hash, server-only).
- **Sensitive actions need fresh proof.** Changing your password, exporting your data, and deleting your account all require either a recent password-recovery sign-in or your current password re-entered while unlocked — not just an open session. New passwords must be at least 10 characters.
- **Private build option.** `ORBIS_ALLOWED_EMAILS`, when set, closes sign-up entirely and signs out anyone already in a session whose address isn't listed, checked on every request.
- **CSP and headers.** A strict, nonce-based Content-Security-Policy plus HSTS, frame-denial, MIME-sniffing protection and a locked-down Permissions-Policy (see Architecture above).
- **AI consent and data sensitivity.** AI is off by default per account; the router only ever sends personally-sensitive requests to a provider that has committed not to train on them, and never sends anything until consent is recorded.
- **Rate limits and uploads.** Costly actions (uploads, parsing, Gmail sync) are capped per person per day/hour, checked server-side and failing closed if the limiting mechanism itself is unavailable. Large files go straight from the browser to a private Storage bucket with a one-time signed URL and a server-side claim that can only be consumed once.
- **Provider allowlists.** The AI router, push-notification sending, and OAuth (Google, Zerodha) all validate destination hosts and callback state against a fixed allowlist rather than trusting configuration alone.
- **Data export and deletion.** Settings offers a full JSON export of your own data (fresh auth required) and permanent account deletion (typed confirmation, fresh auth required), covering the tables listed in `lib/account/deletion-plan.ts`.

## More

- [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) — the codebase audit this Phase 1 plan was built from.
- [`BUILD_ROADMAP.md`](./BUILD_ROADMAP.md) — where the project stands and what's next.
- [`docs/phase-1-owner-actions.md`](./docs/phase-1-owner-actions.md) — the checklist of steps only the project owner can do (Vercel/Supabase dashboard settings, migrations, legal copy).
