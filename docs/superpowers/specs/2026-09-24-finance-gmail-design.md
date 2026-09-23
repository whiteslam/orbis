# Orbis Finance Data and Gmail Connection (Phase 2)

**Status:** Approved by user
**Date:** 2026-09-24

## Goal

Let a signed-in Orbis user connect one Gmail account in read-only mode, collect candidate bank and card transaction alert message IDs, and keep finance records private to that Orbis user. Keep Orbis email/password authentication unchanged. Phase 3 will parse candidate messages into normalized transactions.

## Agreed product constraints

- Gmail access is read-only. Orbis will not send, modify, label, archive, or delete email.
- Orbis will search only for transaction-alert candidates, not provide a mailbox viewer or general-purpose email search.
- Google OAuth is a separate connection from Supabase sign-in. Users may connect Gmail without changing their Orbis login method.
- Store no Gmail message body or snippet. Store provider message IDs and the minimum metadata needed for sync and later parsing.
- One Gmail connection per Orbis account in the first version.
- Finance and Gmail data must be isolated by Orbis user.
- Transaction extraction, merchant/category interpretation, and user review are Phase 3 responsibilities.

## Approaches considered

1. **Separate Google OAuth connection (selected):** Preserve Supabase email/password auth and implement Google OAuth authorization-code flow for Gmail. This separates account identity from mailbox access and provides a durable refresh token for future syncs.
2. **Supabase Google social login:** Couple Google login to Gmail access. This changes the sign-in model and leaves provider-token refresh/persistence as application responsibilities, so it is not selected.

## Architecture

### OAuth and connection lifecycle

1. An authenticated user starts `Connect Gmail` from Finance.
2. The server creates a cryptographically random OAuth `state`, binds it to the authenticated Orbis user, stores the state in a short-lived, HTTP-only, secure-in-production, same-site cookie, and redirects to Google's authorization endpoint. The callback verifies both the state and that the current Orbis user is the same user who started the flow.
3. Request the minimum identity scopes needed to identify the mailbox plus Google's `gmail.readonly` scope. Request offline access so a refresh token can support later syncs. Do not request send, modify, or delete scopes.
4. Google redirects to a dedicated callback. The callback checks state, exchanges the authorization code on the server, verifies the signed-in Orbis user again, identifies the connected Google account, encrypts the refresh token, and stores the connection.
5. Use a dedicated `GMAIL_TOKEN_ENCRYPTION_KEY` (32 bytes, encoded as base64) with authenticated encryption (AES-256-GCM), a fresh random nonce per token, and versioned ciphertext. Never return credentials or ciphertext to browser code or logs. The Google client secret and Supabase secret key are server-only environment variables.
6. If Google does not issue a refresh token for a reconnect, preserve the existing encrypted refresh token rather than replacing it with an unusable empty value. If no prior token exists, report that reconnect consent is needed and do not mark the connection ready.
7. Disconnect revokes the Google token where possible, then deletes the local connection and associated sync candidates. Local deletion still proceeds if remote revocation fails; show an actionable status.

### Gmail sync boundary

- A user starts sync explicitly from Finance. No background or scheduled sync is included in Phase 2.
- The server decrypts the token, refreshes access as needed, and calls Gmail list APIs with a conservative transaction-alert query. Search/import window defaults to the most recent 12 months for the first sync. Persist the initial sync start time and resume interrupted imports with the same fixed absolute `after:` cutoff and Gmail page token, so a later retry cannot shift the search window. Later syncs use Gmail search with the same transaction-alert terms and an `after:` date three days before the last completed sync; the small overlap protects against date-boundary and delayed-message gaps. Persist the query start and page token while a bounded sync is incomplete, then advance the completed sync time only after all pages are processed. Candidate upserts are idempotent. Orbis does not use broad history listing to inspect unrelated new mail.
- Persist only the Gmail message ID, thread ID, received timestamp, and sync state for each candidate. Never persist bodies, snippets, attachments, or full headers. Candidate matching is only a coarse discovery step; it must not claim a transaction exists until Phase 3 parses the message.
- Use `(connection_id, gmail_message_id)` as a unique key so repeated syncs are idempotent.
- Handle Google revocation/expired authorization by marking the connection as needing reconnection. Handle Gmail quota/network errors with a user-visible retry message and a safe, non-sensitive server log.
- Bound each sync page and return progress/candidate counts. A later phase can add scheduled sync if needed.

### Finance data

Create a `transactions` table for Phase 3 and later user-entered records, with owner, positive amount, currency, transaction direction (expense or income), merchant, category, occurrence time, source, optional source message ID, and created/updated timestamps. Use `numeric` for money, a three-letter currency code, and a partial unique index on `(user_id, source_message_id)` for Gmail-imported transactions. Treat candidate email records as separate from transactions so unparsed messages never appear as confirmed spending.

Create `gmail_connections` for one encrypted refresh token and provider-account metadata per Orbis user. Create `gmail_sync_messages` for minimal candidate IDs and sync state. Add indexes for owner/time transaction queries and pending candidate lookups. Use foreign keys with deletion cascading from the owning user/connection where appropriate.

### Authorization and row-level security

- Enable RLS on all user-owned tables.
- `transactions`: authenticated users may select, insert, update, and delete only rows where `user_id = auth.uid()`; inserts and updates must preserve that ownership.
- `gmail_connections` and `gmail_sync_messages`: browser roles receive no access. RLS is enabled with no client policies. Dedicated server handlers first validate the Supabase cookie session, derive `user_id` from verified claims (never request payload), and then use the server-only Supabase secret key with explicit owner filters.
- Never expose the Supabase secret key, Google client secret, encryption key, or Gmail refresh token to client bundles, URLs, user-facing errors, or logs.

## UI changes

- Replace the Finance screen's Gmail placeholder with connection status, a `Connect Gmail` action, a last-sync summary, candidate count, a manual `Sync now` action, and `Disconnect`.
- Show clear states for not connected, connecting, connected, syncing, sync complete, reconnect required, and retryable failure.
- Keep transaction totals and charts clearly identified as sample/empty until parsed or manually entered transaction data exists. Do not present candidate message counts as spending totals.

## Environment and external setup

Add documented empty placeholders to `.env.example` for Google OAuth client ID/secret and `GMAIL_TOKEN_ENCRYPTION_KEY`; do not add actual credentials. The owner must configure a Google Cloud OAuth consent screen and web OAuth client with the local callback URI `http://localhost:3000/auth/gmail/callback`, enable Gmail API, and add the client ID, client secret, and encryption key to local `.env.local`. Gmail's `gmail.readonly` scope is restricted; Google may require verification and, depending on deployment and data handling, a security assessment before production use. Initial local development may be limited to OAuth test users and consent-screen publishing mode.

## Out of scope

- Parsing email bodies into transaction fields, categorization, duplicate transaction resolution, or review/approval of extracted transactions (Phase 3).
- AI analysis/advice, Excel upload, investments, recurring/background sync, multiple Gmail accounts, non-Gmail providers, or automatic email actions.
- Committing secrets or initializing a Git repository. The user previously asked to build first and create the repository later.

## Acceptance criteria

1. Existing email/password Supabase sign-in and password reset continue to work unchanged.
2. A signed-in user can connect one Gmail account using the read-only scope and see the connected address/status.
3. A signed-in user can explicitly sync transaction-alert candidates from the most recent 12 months; repeated syncs do not duplicate candidate records.
4. Candidate storage contains no message body, snippet, attachment, or full header.
5. User A cannot access User B's transactions or Gmail connection/candidate metadata through application routes or direct database APIs.
6. A user can disconnect; the local token and candidate records are removed even if Google revocation is unavailable.
7. The Finance screen distinguishes parsed transactions from unparsed email candidates and has usable empty, loading, success, reconnect, and error states.
8. Setup instructions document the required Google configuration and environment variable names without exposing credentials.

## Decisions to confirm during review

- The first sync imports up to the most recent 12 months of candidate alerts.
- OAuth callback is `/auth/gmail/callback` and there is no automatic background sync in this phase.
- Candidate matching will use conservative Gmail search operators and the supported alert patterns will be refined in Phase 3; it will not ingest all mailbox messages.

## Reference documentation

- [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Gmail API OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Supabase Google sign-in and provider token guidance](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
