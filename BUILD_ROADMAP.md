# Orbis Build Roadmap

Use this file to see where the project stands and what to do next, even between Codex sessions. Update the status and checkboxes as work is completed.

**Last updated:** 2026-09-24
**Current app:** `http://localhost:3000` (`pnpm dev`)
**Current focus:** Apply the Supabase migrations, connect Google/OpenRouter, then deploy to Vercel

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
- [ ] Configure the OpenRouter key in local/Vercel server environments and try a real workbook

**Next:** Connect the OpenRouter server key and review advice against a representative workbook. Workbook data is never persisted.

### 5. Orbis memory and retrieval — Planned

- [ ] Decide what information Orbis should remember
- [ ] Store and retrieve relevant personal context with pgvector/RAG
- [ ] Let users inspect and manage saved memory

### 6. AI gateway and usage limits — In progress

- [x] Call OpenRouter only from a server action; bound request and response sizes
- [x] Add an atomic five-advice-attempts-per-user-per-UTC-day budget
- [x] Keep API keys out of browser code
- [ ] Add durable aggregate generation records (workbook data and advice remain unpersisted by design)
- [ ] Add request budgets and useful failure handling
- [ ] Ground responses in the relevant user data and explain uncertainty

### 6a. Goals and habits — In progress

- [x] Replace demo goals and habit streaks with authenticated user-owned Supabase records
- [x] Add goal creation and progress updates
- [x] Add habit creation and daily check-ins with streak display
- [x] Add RLS and owner-scoped check-in records
- [ ] Apply `supabase/migrations/202609240004_goals_habits.sql` in Supabase and verify with the signed-in account

### 7. Daily Orbis Brief — Planned

- [ ] Combine available finance, health, goals, and memory signals
- [ ] Generate a concise daily brief
- [ ] Show the brief on Home and handle missing data clearly

## Resume checklist

When returning to the project:

1. Open this file and start from the **Current focus** and the first unchecked **Next** item.
2. Start the app with `pnpm dev` and open `http://localhost:3000`.
3. Before ending a work session, update the relevant phase status, checkboxes, and **Last updated** date.
4. Record decisions or blockers in the relevant phase so the next session can continue without rediscovery.

## Project notes

- Goals and habits are connected to user-owned tables after migration 004 is applied. Investment and Personal memory are still planned.
- Never put API keys in client-side code or commit secret values.
- The original build-order notes are in `CLAUDE.md`.
