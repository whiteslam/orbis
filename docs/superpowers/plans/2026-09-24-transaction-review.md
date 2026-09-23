# Gmail Transaction Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn bounded Gmail alert candidates into editable proposals and save only transactions the user confirms.

**Architecture:** Fetch `format=full` only after a user action; decode and parse a limited plain-text MIME body in memory; save parsed fields, not message content. Authenticated Finance actions confirm or ignore candidate IDs scoped to the user's connection.

**Tech Stack:** Gmail REST API, deterministic TypeScript parser, Next.js Server Actions, Supabase service-role operations with owner filtering, SQL migrations, React.

**Spec:** `docs/superpowers/specs/2026-09-24-transaction-review-design.md`

## Global Constraints

- Parse at most five candidates per action and at most 100 KiB of decoded body per candidate.
- Do not persist raw email body/snippet/header content beyond currently approved mailbox address and subject-only matching; store extracted transaction fields only.
- Revalidate the Orbis user in every Server Action, filter service-role queries by `user_id` and owned connection, and accept no browser-supplied user IDs.
- Confirmation is user initiated and idempotent by `(user_id, source_message_id)`.
- Do not run tests per the user's project instruction; use `pnpm build` as compile validation.

## Review Focus

- Large, corrupt, HTML-only, attachment, and unusual base64 MIME inputs: reject/skip safely without persisting content.
- Ambiguous currency, amount, or direction formats: do not create transactions without explicit user editing/confirmation.
- Cross-user/replayed candidate IDs and double confirmation: enforce owner filters and unique-key idempotency.
- Provider/network failures: preserve candidate state and report a recoverable message.
- Browser-supplied edited values: validate amount, currency, direction, merchant length, candidate status, and date.

---

### Task 1: Add transaction proposal fields and deterministic parser

**Files:**
- Create `supabase/migrations/202609240003_transaction_review.sql`.
- Create `lib/finance/parse-alert.ts`.
- Modify `lib/gmail/api.ts`.

**Interfaces:**
- `getMessagePlainText(accessToken, messageId): Promise<string | null>` returns only bounded plain text or null; body never leaves server.
- `parseTransactionAlert(input): ParsedTransactionProposal` returns nullable amount/currency/direction/merchant and reason.

- [ ] Add checked parse-state and extracted field columns to `gmail_sync_messages`; never add a body column.
- [ ] Fetch only `text/plain` part data with `format=full`; bound MIME part data, ignore attachmentId/filename and HTML.
- [ ] Decode base64url to UTF-8; reject invalid encoding and >100 KiB body.
- [ ] Extract explicit amount/currency/direction with conservative patterns and normalize merchant; mark confidence/reason for review.

### Task 2: Add owner-scoped parse, confirm, and ignore actions

**Files:**
- Modify `app/finance/actions.ts`.
- Modify `lib/finance/sync.ts` or add `lib/finance/review.ts`.

**Interfaces:**
- `parsePendingFinanceCandidatesAction(): Promise<FinanceActionState>`.
- `confirmFinanceCandidateAction(input: CandidateConfirmation): Promise<FinanceActionState>`.
- `ignoreFinanceCandidateAction(candidateId: string): Promise<FinanceActionState>`.

- [ ] Derive the owned Gmail connection and at most five pending unparsed candidate IDs from authenticated user ID.
- [ ] Refresh the Google access token, parse each message sequentially/bounded, and persist only extracted proposal fields plus parse status.
- [ ] Confirm by validating all edited fields, insert transaction with candidate Gmail ID, handle unique conflict idempotently, then mark processed.
- [ ] Ignore only a candidate from the user's connection; no Gmail mutation API calls.
- [ ] Sanitize errors and never log text or token values.

### Task 3: Add Finance review UI and summary data

**Files:**
- Modify `lib/finance/repository.ts`, `lib/finance/types.ts`, and `components/orbis-app.tsx`.
- Modify `app/globals.css`.

- [ ] Load a bounded owner-filtered candidate DTO with parsed fields and status, without email bodies.
- [ ] Add “Parse alerts” and a compact editable review card; validate values in both browser and server.
- [ ] Show explicit Confirm and Ignore controls; refresh totals only after confirmation.
- [ ] Replace Phase 3 placeholder copy and add failure/empty/in-progress states.

### Task 4: Update migration/setup docs and verify compilation

**Files:**
- Modify `README.md` and `BUILD_ROADMAP.md`.

- [ ] Document the new migration and manual Supabase application order.
- [ ] Mark implementation complete while retaining external Google setup as pending.
- [ ] Run `pnpm build` and record the result.
