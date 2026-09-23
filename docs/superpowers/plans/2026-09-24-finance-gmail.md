# Finance Data and Gmail Connection Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add owner-private finance tables and a separate, read-only Gmail connection that can collect transaction-alert candidates for Phase 3 parsing.

**Architecture:** Keep Supabase email/password sign-in unchanged. Use a server-side Google OAuth authorization-code flow, encrypt its refresh token with AES-256-GCM, and use Gmail read-only API calls only after validating the current Orbis user. Persist only candidate message identifiers and minimal sync metadata; keep candidates distinct from confirmed transactions.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Auth/Postgres/RLS, Google OAuth 2.0 and Gmail REST API, Node.js built-in `crypto` and `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-24-finance-gmail-design.md`

## Global Constraints

- Gmail access is read-only. Orbis will not send, modify, label, archive, or delete email.
- Store no Gmail message body or snippet. Store provider message IDs and the minimum metadata needed for sync and later parsing.
- One Gmail connection per Orbis account in the first version.
- Finance and Gmail data must be isolated by Orbis user.
- Transaction extraction, merchant/category interpretation, and user review are Phase 3 responsibilities.
- The Gmail OAuth callback is `http://localhost:3000/auth/gmail/callback` for local development.
- The existing email/password Supabase sign-in and password reset must continue working unchanged.
- Do not initialize Git or commit; the user intends to create the repository later.
- Do not put secrets in client code, URLs, logs, documentation, or command output.
- Do not add or run tests unless the user asks to test or verify implementation. Keep each task reviewable and use the app build as a compile check if implementation is later authorized.

## Review Focus

- OAuth callback with missing/incorrect state or a different signed-in Orbis user must not attach a mailbox.
- Missing refresh token on reconnect must not overwrite a previously valid encrypted refresh token.
- Invalid encryption key, malformed ciphertext, or Google token revocation must fail safely and request reconnection without leaking credentials.
- Repeated sync pages and the three-day incremental overlap must not duplicate candidates or lose messages when a sync is interrupted.
- Browser/API attempts to access another user's transactions or any Gmail credential/candidate data must be denied.

## File Map

- Create `supabase/migrations/202609240001_finance_gmail.sql`: tables, constraints, indexes, grants, and RLS policies.
- Create `lib/supabase/admin.ts`: server-only Supabase client with session persistence disabled.
- Create `lib/gmail/config.ts`: validate Google OAuth and encryption environment variables without exposing their values.
- Create `lib/gmail/crypto.ts`: versioned AES-256-GCM refresh-token encryption and decryption.
- Create `lib/gmail/oauth.ts`: state generation/validation, Google authorization URL, code exchange, account identity lookup, token refresh, and revoke operations.
- Create `app/auth/gmail/start/route.ts` and `app/auth/gmail/callback/route.ts`: authenticated authorization start and OAuth callback.
- Create `lib/gmail/api.ts`: bounded Gmail query pagination that returns only allowed candidate metadata.
- Create `lib/finance/repository.ts`: owner-filtered database operations for Finance summary, connection, sync candidate, and transaction data.
- Create `app/finance/actions.ts`: authenticated server actions for sync and disconnect.
- Modify `app/page.tsx`: load an owner-scoped Finance summary on the server and pass serializable data to OrbisApp.
- Modify `components/orbis-app.tsx` and `app/globals.css`: replace the Finance mock state and Gmail placeholder with connection/sync/empty states and controls.
- Modify `.env.example`, `README.md`, and `BUILD_ROADMAP.md`: variable names, Google Cloud setup, status, and remaining Phase 3 work.

## Implementation Tasks

### Task 1: Add finance schema and access policies

**Files:**
- Create: `supabase/migrations/202609240001_finance_gmail.sql`

**Interfaces:**
- Later server code consumes tables `public.transactions`, `public.gmail_connections`, and `public.gmail_sync_messages`.
- `gmail_connections`: `id uuid`, `user_id uuid`, `google_email text`, `refresh_token_encrypted text`, `status text`, `last_sync_at timestamptz`, `incremental_sync_after text`, `incremental_sync_page_token text`, `initial_sync_page_token text`, `initial_sync_started_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`; unique `user_id` and unique `(id, user_id)` for the composite candidate foreign key.
- `gmail_sync_messages`: `id uuid`, `connection_id uuid`, `user_id uuid`, `gmail_message_id text`, `gmail_thread_id text`, `received_at timestamptz`, `sync_state text`, `created_at timestamptz`; unique `(connection_id, gmail_message_id)` and composite FK `(connection_id, user_id)` to the connection owner.
- `transactions`: `id uuid`, `user_id uuid`, `amount numeric(14,2)`, `currency text`, `direction text`, `merchant text`, `category text`, `occurred_at timestamptz`, `source text`, nullable `source_message_id text`, and timestamps.

- [ ] Create the three tables with `auth.users(id)` ownership FKs, cascading deletion, defaults, `NOT NULL` where applicable, and checks: amount > 0; uppercase three-character currency; direction in `expense|income`; source in `gmail|manual`; connection status in `connected|reconnect_required`; candidate state in `pending|processed|ignored`.
- [ ] Add a unique partial index on `(user_id, source_message_id)` when source is Gmail and the message ID is not null; add `(user_id, occurred_at desc)` for transaction timelines and `(connection_id, sync_state, received_at desc)` for pending candidates.
- [ ] Enable RLS on all three tables. Give authenticated users CRUD policies on transactions whose `user_id = auth.uid()`; enforce the same ownership check in both `USING` and `WITH CHECK`.
- [ ] Add no browser-role policies for Gmail connection/candidate tables; revoke table access from `anon` and `authenticated`, and grant the needed access to `service_role`. Server code will use the secret key only after validating the owner.
- [ ] Review SQL policy and owner constraints against the schema section in the approved spec; leave the database unchanged until the user applies the migration in Supabase.

**Manual acceptance:** The migration is idempotent only if written with guarded object creation where practical; inspect that RLS is enabled, transaction ownership is enforced, and Gmail tables have no direct browser access policies.

### Task 2: Add server-only configuration and token protection

**Files:**
- Create: `lib/supabase/admin.ts`
- Create: `lib/gmail/config.ts`
- Create: `lib/gmail/crypto.ts`

**Interfaces:**
- `createAdminClient(): SupabaseClient` uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`, with `persistSession: false`, `autoRefreshToken: false`, and `detectSessionInUrl: false`.
- `getGmailConfig(): { clientId: string; clientSecret: string; redirectUri: string; tokenEncryptionKey: Buffer }` validates `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and base64 `GMAIL_TOKEN_ENCRYPTION_KEY`.
- `encryptRefreshToken(token: string): string` returns a versioned base64 envelope containing nonce, authentication tag, and ciphertext.
- `decryptRefreshToken(envelope: string): string` rejects unknown versions, invalid key length, malformed base64, and failed authentication.

- [ ] Implement config validation on the server; never use `NEXT_PUBLIC_` for Google credentials or encryption key.
- [ ] Use Node `randomBytes(12)` nonce and `createCipheriv('aes-256-gcm', key, nonce)`; encode an explicit version, nonce, auth tag, and ciphertext in the stored envelope.
- [ ] Ensure decrypted tokens and encryption material are not included in thrown messages or logs.
- [ ] Review the output and error paths to confirm the admin client and crypto module are server-only.

**Manual acceptance:** A server-only route can load valid local configuration; missing or malformed values produce safe setup messages, and no secret value is returned to browser props.

### Task 3: Implement Google OAuth connection and callback

**Files:**
- Create: `lib/gmail/oauth.ts`
- Create: `app/auth/gmail/start/route.ts`
- Create: `app/auth/gmail/callback/route.ts`
- Consume: `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/gmail/config.ts`, `lib/gmail/crypto.ts`

**Interfaces:**
- `getAuthenticatedUserId(): Promise<string>` calls the existing cookie-backed Supabase client `auth.getClaims()` and rejects missing claims.
- `buildGoogleAuthorizationUrl(state: string): string` requests `openid email https://www.googleapis.com/auth/gmail.readonly`, `access_type=offline`, and `state`.
- `exchangeGoogleCode(code: string): Promise<GoogleTokenResponse>` exchanges a callback code server-side.
- `getGoogleAccount(accessToken: string): Promise<{ sub: string; email: string }>` uses verified OIDC identity data.
- `storeGmailConnection(userId: string, email: string, token: string): Promise<void>` encrypts the token and upserts only the authenticated owner.

- [ ] At `/auth/gmail/start`, require a valid Supabase session, generate 32 random state bytes, bind state and the current user ID into an HMAC-signed short-lived HTTP-only SameSite=Lax cookie (HMAC-SHA256 with a server-only secret), use Secure in production, and redirect to Google.
- [ ] At `/auth/gmail/callback`, compare callback state using a constant-time comparison, revalidate the Supabase user, verify it matches the state-bound user, reject provider errors/missing code, and clear the state cookie on every exit.
- [ ] Exchange the code server-side, fetch the Google account identity, and upsert by `user_id` with the encrypted refresh token and connected address. Keep an existing refresh token if Google omits a new one; if there is no old token, redirect to a clear reconnect-consent message.
- [ ] Validate callback URLs against the configured `GOOGLE_REDIRECT_URI`; never accept a `next` URL from the query string.
- [ ] Add no token values to callback URLs or responses. Redirect to Finance with a small allowlisted status marker.
- [ ] Connect the web OAuth client by adding `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/gmail/callback` to local configuration. The supplied JSON is a Web OAuth client with a client ID and secret, but its current authorized redirect list contains only `http://Orbis.ractrotech.com`; that Google Cloud client must be updated to include the exact local callback URL before local OAuth can succeed.

**Manual acceptance:** A signed-in user reaches Google consent; state mismatch, unauthenticated callback, account switching, provider denial, and missing configuration all fail safely without creating or changing a connection.

### Task 4: Implement candidate sync, status, and disconnect

**Files:**
- Create: `lib/gmail/api.ts`
- Create: `lib/finance/repository.ts`
- Create: `app/finance/actions.ts`
- Consume: `lib/gmail/oauth.ts`, `lib/gmail/crypto.ts`, `lib/supabase/admin.ts`

**Interfaces:**
- `getFinanceSummary(userId: string): Promise<FinanceSummary>` returns serializable connection `{ email, status, lastSyncAt }`, `pendingCandidateCount`, and owner-scoped parsed transaction totals.
- `syncGmail(userId: string): Promise<{ candidatesAdded: number; lastSyncAt: string }>` validates and decrypts the stored token, refreshes it, and idempotently inserts candidate metadata.
- `disconnectGmail(userId: string): Promise<{ revoked: boolean }>` attempts remote revoke and always removes that owner's local connection and cascading candidates.
- `syncFinanceAction(): Promise<ActionState>` and `disconnectGmailAction(): Promise<ActionState>` derive the user from server claims, never form fields, and revalidate `/`.

- [ ] Implement access-token refresh and Gmail REST calls with native server `fetch`; request only message IDs and then metadata headers needed for thread ID/date, never `format=full`, body, snippet, attachment, or full headers.
- [ ] Define an initial Gmail query from the persisted import start time, using a fixed absolute cutoff about 12 months earlier and conservative transaction-alert subject terms; define incremental queries with the same subject terms plus an `after:` date three days before the last completed sync.
- [ ] Use Gmail list page tokens with a fixed page cap per user action. Persist `initial_sync_page_token` for the 12-month import; persist the incremental query date and `incremental_sync_page_token` for an interrupted recent sync. Only advance `last_sync_at` when all pages for the current query complete. If an API page fails, preserve the prior cursor and report a retryable error.
- [ ] Mark auth revocation/invalid grant as `reconnect_required`; map quota, network, decryption, and schema failures to generic user messages without logging tokens or email content.
- [ ] On disconnect, decrypt only in memory for Google's revoke endpoint; delete the local row regardless of remote response, and return whether revocation succeeded so the UI can explain remaining Google-side cleanup if needed.
- [ ] Ensure every admin query and mutation includes `user_id = authenticatedUserId`; do not trust a client-supplied connection ID as authorization.
- [ ] Keep `gmail_sync_messages` as candidates only; do not insert into `transactions` in this task.

**Manual acceptance:** A user-triggered sync stores candidate IDs once across repeated syncs; a revoked Google grant changes the connection state; disconnect removes local connection and candidates even when remote revoke fails.

### Task 5: Replace Finance mock integration with live owner-scoped UI

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/orbis-app.tsx`
- Modify: `app/globals.css`
- Consume: `lib/finance/repository.ts`, `app/finance/actions.ts`

**Interfaces:**
- `OrbisApp` receives a serializable `financeSummary: FinanceSummary` prop from the authenticated server page.
- Finance screen renders connection status and invokes `syncFinanceAction` / `disconnectGmailAction` using React transition state; connect is a link to `/auth/gmail/start`.

- [ ] Extend `app/page.tsx` after its existing verified-claims check to load the Finance summary with `claims.sub`; do not pass the admin client or encrypted token to the client component.
- [ ] Replace ₹24,320, the sample trend chart/category values, and “Ready for Google OAuth integration” with truthful empty/connected states. Do not show candidate count as expenses.
- [ ] Add Connect, Sync now, and Disconnect controls and display mailbox address, last sync, candidate count, loading/success/error/reconnect states, and a note that Gmail permission is read-only.
- [ ] Preserve the existing bottom navigation and Home/Health mock screens while limiting this change to Finance-specific visuals and behavior.
- [ ] Verify each action's UI updates from its server action result and that disconnected/empty accounts do not display fabricated spending totals.

### Task 6: Document Google setup and handoff status

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `BUILD_ROADMAP.md`

- [ ] Document local Google Cloud setup: enable Gmail API, use a Web OAuth client, add `http://localhost:3000` as an authorized JavaScript origin only if Google requires it, add the exact callback URI `http://localhost:3000/auth/gmail/callback`, and configure the consent-screen test user.
- [ ] Read the supplied Web OAuth JSON at `/home/gaurav-mirjha/Downloads/client_secret_1053934278594-84fbc532te0d3ka5sn9bja41sd676gbg.apps.googleusercontent.com.json` without printing its values; place only its client ID and client secret into ignored `.env.local`, set the local redirect URI, and generate a fresh base64 32-byte encryption key directly into the environment file.
- [ ] Add empty example variables for Google OAuth client ID/secret, redirect URI, and token encryption key to `.env.example`; never copy live credentials there.
- [ ] Add a short instruction to apply the Supabase migration in the SQL Editor because the project currently has no Supabase CLI/migration workflow configured.
- [ ] Document that the supplied Web OAuth JSON currently allows only `http://Orbis.ractrotech.com`; instruct the user to add the local callback URI in Google Cloud before trying the local connection.
- [ ] Document how to generate and store a base64 32-byte token-encryption key locally, and state that Google restricted-scope verification may be needed before production use.
- [ ] Update `BUILD_ROADMAP.md` Phase 2 statuses only for implemented items; leave Google dashboard configuration pending until the user completes it. Keep Phase 3 parsing unchecked.
- [ ] Preserve the existing Supabase auth setup and never copy any credential into docs or source control.

## Final Acceptance Walkthrough

- Existing login, sign-out, and password reset routes remain intact.
- Google callback refuses invalid state and a changed Orbis user; valid connection displays the Google mailbox address without exposing credentials.
- Sync imports only minimal candidate metadata for a bounded 12-month window, is repeatable without duplicate candidates, and handles reconnection errors.
- Finance transactions obey owner RLS; Gmail connection and candidate tables have no browser data access.
- Disconnect removes local encrypted credentials and candidate metadata, even if Google revocation fails.
- Finance UI reports empty/unparsed state honestly and does not use sample amounts as live financial data.
- `.env.local` secrets remain ignored, absent from `.env.example`, and absent from client props/logging.
