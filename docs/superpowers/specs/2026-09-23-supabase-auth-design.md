# Orbis Supabase Authentication Design

**Status:** Approved for implementation
**Date:** 2026-09-24

## Goal

Let a person create an Orbis account, sign in with email and password, recover a forgotten password by email, and keep the Orbis app available only to signed-in users. Use the Supabase project already configured in the local environment.

## User experience

- A signed-out visitor who opens `/` is sent to `/login`.
- The login screen offers email/password sign-in and account creation, with links between those modes.
- A **Forgot password?** link opens `/forgot-password`. Submitting an email requests a Supabase recovery email and shows a neutral confirmation message.
- The recovery email returns to the app through `/auth/callback`, which exchanges the PKCE code for a session and redirects to `/reset-password`.
- The reset screen lets the signed-in recovery session set a new password, then returns the person to sign-in with a success message.
- A signed-in user can sign out. Auth errors are shown inline in plain language; forms expose loading and disabled states.
- Signup confirmation follows the Supabase project's current Auth settings. If email confirmation is enabled, the UI tells the user to check their email before signing in.

## Technical design

- Use `@supabase/ssr` with separate browser and server client helpers, and `@supabase/supabase-js` as its client library.
- Use cookie-backed PKCE sessions. Add a Next.js 16 `proxy.ts` session-refresh entry point and use verified claims when protecting server-rendered routes; do not authorize from an unverified cookie session.
- Keep auth actions in small server actions or route handlers where server execution is needed. Use a browser client only for form interactions that need client-side state.
- Add an auth callback route to exchange the one-time code and validate its local `next` destination. Redirect only to same-origin app paths to avoid open redirects.
- Protect the Orbis home route on the server. Keep login, forgot-password, reset-password, and the callback reachable while signed out.
- Use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in client-capable code. Keep `SUPABASE_SECRET_KEY` server-only; this authentication flow should not need the secret key.
- No user-owned application data table exists yet. Do not add a placeholder profile table just to claim RLS is complete. Add and verify RLS policies in the same phase that creates each real user-owned data table, before that table is used by the app.

## Files and scope

Expected implementation areas:

- `lib/supabase/client.ts` and `lib/supabase/server.ts` for cookie-aware clients.
- `lib/supabase/proxy.ts` and root `proxy.ts` for session refresh.
- Login, forgot-password, reset-password, and callback routes under `app/`.
- A small auth form component and sign-out control integrated with the existing Orbis shell.
- `package.json` and `pnpm-lock.yaml` for Supabase dependencies.
- `BUILD_ROADMAP.md` to record Phase 1 progress and defer RLS to the first real data schema.

Out of scope: social login, multi-factor authentication, account deletion, user profiles, finance/health schemas, Gmail, spreadsheet upload, and AI advice.

## Configuration needed

The Supabase project URL and publishable key are already in the local `.env.local`, and the secret key remains server-only. Before recovery links can work, Supabase Auth must allow the local callback URL `http://localhost:3000/auth/callback` (and the reset destination). Production redirect URLs and email delivery configuration will be needed when deploying. No secret values belong in this document.

## Failure handling and security

- Validate email and password inputs on the server; rely on Supabase Auth for credential checks and password policy enforcement.
- Never expose whether a submitted address belongs to an account in the forgot-password response.
- Handle invalid, expired, and already-used recovery links with a recoverable message and a link to request a fresh email.
- Validate the callback destination and keep it on the same origin.
- Do not log passwords, recovery codes, access tokens, refresh tokens, or secret keys.
- Use the publishable key for user-scoped Auth operations. Do not use the secret key to bypass row-level security.
- Application data access remains blocked until its schema has owner-scoped RLS policies.

## Acceptance criteria

- A new account can be registered and, when required by project settings, confirmed by email.
- A registered account can sign in, remain signed in across page requests, and sign out.
- Signed-out visitors cannot render the protected Orbis home screen.
- A user can request a reset email, open a valid recovery link, set a new password, and sign in with it.
- Invalid credentials, expired recovery links, network errors, and email confirmation requirements have understandable UI states.
- The server-only secret is never imported into a client component or emitted to browser code.
- Before any future user-owned table is used, an RLS migration restricts rows to their owner and is verified with owner and non-owner access checks.

## References

- Supabase SSR client setup: https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
- Supabase SSR overview and PKCE guidance: https://supabase.com/docs/guides/auth/server-side
- Supabase API key handling: https://supabase.com/docs/guides/getting-started/api-keys
