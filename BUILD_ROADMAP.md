# Orbis Build Roadmap

Use this file to see where the project stands and what to do next, even between Codex sessions. Update the status and checkboxes as work is completed.

**Last updated:** 2026-09-24
**Current app:** `http://localhost:3000` (`pnpm dev`)
**Current focus:** Finish the local build; then complete the single external setup checklist below

## Status key

- **Complete** — built and confirmed working
- **In progress** — implementation has started
- **Planned** — agreed direction, work not started
- **Needs decision** — waiting on a product or setup choice

## Phases

### 0. Starter app and local setup — Complete

- [x] Install project dependencies with `pnpm install`
- [x] Start the Next.js app locally
- [x] Fix the `@/` TypeScript import alias so the app page resolves
- [x] Starter screens exist for Home, Finance, Health, Personal, Invest, Goals, and Habits

### 1. Account and authentication — In progress

Set up Supabase authentication and row-level security (RLS) so personal data is private to its owner.

- [x] Choose/create the Supabase project
- [x] Add local environment values without committing secrets
- [x] Add ignore rules and a safe environment-variable template
- [x] Add cookie-backed Supabase clients and Next.js session refresh
- [x] Add email/password sign-up, sign-in, and sign-out
- [x] Add forgot-password email and password reset flow
- [x] Protect the Orbis home screen with verified session claims
- [ ] Add `http://localhost:3000/auth/callback` to Supabase Auth's allowed redirect URLs
- [ ] Confirm email confirmation and recovery email delivery from the Supabase project

**Next:** Allow the local auth callback URL in Supabase Auth and confirm email/recovery delivery. The Finance migration now adds the first user-owned tables with RLS.

RLS is intentionally deferred until a real data table is introduced; the app does not create a placeholder profile table.

### 2. Finance data and Gmail connection — In progress

- [x] Design the finance schema and owner-scoped RLS policies
- [x] Add the Supabase migration for transactions, Gmail connections, and candidate message metadata
- [x] Build a separate Google OAuth authorization-code flow with signed account-bound state
- [x] Encrypt Gmail refresh tokens server-side and keep them out of client responses
- [x] Add user-triggered, bounded Gmail candidate sync with idempotent message IDs
- [x] Replace Finance mock totals and Gmail placeholder with database-backed empty/connection states
- [ ] Apply `supabase/migrations/202609240001_finance_gmail.sql` in Supabase SQL Editor
- [ ] Add `http://localhost:3000/auth/gmail/callback` as an Authorized redirect URI for the Google Web OAuth client
- [ ] Enable Gmail API and add the Google account as an OAuth consent-screen test user
- [ ] Complete a real local Gmail connection and sync after dashboard setup

**Next:** Apply the finance migration in Supabase, add the exact Google callback URI in Google Cloud, and enable the Gmail API. The supplied OAuth JSON is already in local `.env.local`; its secret values were not added to project documentation.

### 3. Transaction parsing — In progress

- [x] Parse supported transaction emails with conservative deterministic rules
- [x] Read bounded plain-text parts on user request and discard bodies after parsing
- [x] Handle duplicate confirmations idempotently and leave unknown formats for manual entry
- [x] Require user review/edit/confirm or ignore before saved transaction totals change
- [x] Bound Gmail full-message responses while streaming and reject ambiguous amount/direction matches
- [ ] Review parser behavior with representative real bank alerts after Gmail setup

**Next:** Apply transaction review migration, enable Gmail API, connect account, and tune format coverage using user-reviewed alerts.

### 4. Health data and Excel upload — In progress

The user asked to upload an Excel workbook, read its data, and receive useful advice in Orbis.

- [x] Support health, finance, activity, and mixed spreadsheets
- [x] Use OpenRouter with a server-side key and configurable model
- [x] Support `.xlsx` and `.csv`, with strict file, row, column, and cell limits
- [x] Build a workbook preview before any AI-provider call
- [x] Extract bounded previews and deterministic numeric observations in memory
- [x] Generate advice only after user consent, and filter evidence to signed observations
- [x] Check XLSX archive expansion before parsing to limit ZIP-bomb resource usage
- [x] Rebuild signed preview payloads from bounded allowlisted fields and cap streamed AI responses
- [x] Require numeric evidence and discard advice that does not cite a valid workbook observation
- [ ] Configure the OpenRouter key in local/Vercel server environments and try a real workbook

**Next:** Connect the OpenRouter server key and review advice against a representative workbook. Workbook data is never persisted.

### 5. Orbis memory and retrieval — Code complete; database setup pending

- [x] Let users add, review, and delete their own context notes
- [x] Store notes in a private RLS-protected table
- [x] Add an explicit opt-in to include up to five recent saved notes in workbook advice
- [x] Retrieve up to five relevant notes from a bounded set of the user's own notes when the user opts in
- [ ] Consider semantic pgvector search after real usage demonstrates a need; current retrieval is private, bounded, and keyword-ranked

### 6. AI gateway and usage limits — Code complete; database/provider setup pending

- [x] Call OpenRouter only from a server action; bound request and response sizes
- [x] Add an atomic five-advice-attempts-per-user-per-UTC-day budget
- [x] Rebuild signed previews from allowlisted fields and cap streamed provider responses
- [x] Keep API keys out of browser code
- [x] Add durable aggregate generation records containing outcome, model, provider status, response size, and duration only
- [x] Enforce five attempts per user per UTC day and provide provider/key/limit/timeout error messages
- [x] Ground responses in the relevant user data, require cited workbook evidence, and include caveats
- [ ] Apply `supabase/migrations/202609240007_ai_generation_events.sql` to enable aggregate event logging

### 6a. Goals and habits — In progress

- [x] Replace demo goals and habit streaks with authenticated user-owned Supabase records
- [x] Add goal creation and progress updates
- [x] Add habit creation and daily check-ins with streak display
- [x] Add RLS and owner-scoped check-in records
- [ ] Apply `supabase/migrations/202609240004_goals_habits.sql` in Supabase and verify with the signed-in account
- [ ] Apply `supabase/migrations/202609240005_orbis_memory.sql` in Supabase and verify note management

### 6b. Investment holdings — In progress

- [x] Replace the empty Investment screen with manual holding entry and edits
- [x] Compute estimated values from user-entered units and unit values
- [x] Label values as user-entered, dated, and not live market prices or investment advice
- [x] Add owner-scoped RLS for investment holdings
- [ ] Apply `supabase/migrations/202609240006_investment_holdings.sql` in Supabase and verify with the signed-in account

### 7. Daily Orbis Brief — Core experience complete

- [x] Show a concise Home snapshot from confirmed expenses, pending alerts, goals, and today's habit check-ins
- [x] Handle missing data without inventing insights
- [x] Keep workbook observations out of the Home brief unless a future explicit save/share feature is designed
- [ ] Optional AI-written daily brief is a future enhancement; the current brief is deterministic and data-grounded

### 8. GitHub and Vercel deployment — App pushed; provider setup pending

- [x] Initialize the project Git repository and create a clean `main` history
- [x] Check that local secrets are ignored and no configured secrets appear in committed files
- [x] Exclude dotenv files from Vercel deployment uploads
- [x] Push the project to `https://github.com/whiteslam/orbis.git` on `main`
- [ ] Sign in to Vercel and link this project
- [ ] Add production Supabase and Google OAuth URLs, and required server environment values
- [ ] Add an OpenRouter API key to enable workbook advice in production
- [ ] Apply all Supabase migrations and deploy the production build
- [ ] Verify sign-in, finance review, goals/habits, context notes, and workbook advice on the deployed URL

## One-time external setup checklist

1. In Supabase **Authentication → URL Configuration**, allow `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/gmail/callback`; later add the matching production URLs.
2. In Supabase **SQL Editor**, run migrations `202609240001` through `202609240007` in filename order.
3. In Google Cloud, enable Gmail API, add the Gmail callback URI to the OAuth web client, and add the Google account as a consent-screen test user.
4. In OpenRouter, create an API key and add it as `OPENROUTER_API_KEY` to the local environment and Vercel. Keep it server-only.
5. Sign in to Vercel, import/link `whiteslam/orbis`, add the required environment variables for Production (and Preview if desired), then deploy.
6. In the production Supabase and Google settings, allow `https://<your-vercel-domain>/auth/callback` and `https://<your-vercel-domain>/auth/gmail/callback`; set the production site URL and Google redirect URI to that domain.
7. Verify password sign-in/recovery, Gmail connection and transaction review, goals/habits, notes, manual holdings, and advice with a sample workbook.

## Resume checklist

When returning to the project:

1. Open this file and start from the **Current focus** and the first unchecked **Next** item.
2. Start the app with `pnpm dev` and open `http://localhost:3000`.
3. Before ending a work session, update the relevant phase status, checkboxes, and **Last updated** date.
4. Record decisions or blockers in the relevant phase so the next session can continue without rediscovery.

**Current external blockers:** GitHub `main` is pushed and tracks the requested repository. Vercel CLI is not signed in. Supabase migrations/redirect settings, Google OAuth setup, and the OpenRouter server key still require dashboard access. A production deployment cannot be completed or verified until these are configured.

## Project notes

- Goals, habits, user-managed context notes, and investment entries use owner-private tables after migrations 004–006 are applied. Investment values are manual. Workbook generation events contain operational metadata only; workbook content/advice are not stored.
- Never put API keys in client-side code or commit secret values.
- The original build-order notes are in `CLAUDE.md`.
