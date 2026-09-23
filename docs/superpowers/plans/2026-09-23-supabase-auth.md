# Supabase Email Authentication Implementation Plan

> **For agentic workers:** Follow this plan task by task. Keep the `.env.local` secret server-only and do not create a Git repository or commits as part of this work.

**Goal:** Add Supabase email/password account creation, sign-in, sign-out, protected Orbis access, and forgotten-password recovery to the existing Next.js app.

**Architecture:** Use `@supabase/ssr` with cookie-backed PKCE sessions, separate browser/server client helpers, and a Next.js 16 `proxy.ts` session refresher. Keep auth actions and callback handling server-side; add focused auth pages and protect the existing home route using verified claims. Defer RLS until real user-owned data tables are added.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth, `@supabase/ssr`, `@supabase/supabase-js`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-23-supabase-auth-design.md`

## Global Constraints

- Use email and password for signup and sign-in; include forgotten-password email recovery.
- Store sessions in cookies with PKCE and refresh them through Next.js 16 `proxy.ts`.
- Verify identity with Supabase `getClaims()` before protecting server-rendered pages.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be used by client-capable code.
- Keep `SUPABASE_SECRET_KEY` server-only; this auth flow should not require it.
- Never log credentials, recovery codes, access tokens, refresh tokens, or secret keys.
- Validate callback destinations and allow only same-origin app paths.
- Do not add a placeholder profile table; add RLS alongside each actual user-owned data schema before using it.
- Keep local credentials in ignored `.env.local`; keep `.env.example` empty of secret values.
- Do not create Git metadata or commits; the user plans to create the repository later.

## Review Focus

- **Expired or reused recovery code:** show a clear recovery error and allow requesting a fresh email. (Task 4)
- **Open-redirect callback destination:** reject protocol-relative and external destinations; fall back to `/`. (Task 3)
- **Forgot-password account enumeration:** use the same confirmation response whether or not an account exists. (Task 4)
- **Signed-out direct request to `/`:** verify claims on the server and redirect before rendering the Orbis dashboard. (Task 5)
- **Expired session during navigation:** refresh cookie tokens through `proxy.ts` so valid users stay signed in and invalid users reach `/login`. (Task 2 and Task 5)

---

### Task 1: Add Supabase dependencies and site URL configuration

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `.env.local` (local only; never print or copy the secret value)

**Consumes:** Existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY` values in `.env.local`.

**Produces:** Installed `@supabase/ssr` and `@supabase/supabase-js` packages; a `NEXT_PUBLIC_SITE_URL` setting for constructing same-origin auth redirects.

- [x] Add dependencies with `pnpm add @supabase/ssr @supabase/supabase-js`.
- [x] Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local` and an empty `NEXT_PUBLIC_SITE_URL=` entry to `.env.example`.
- [x] Confirm `.gitignore` still excludes `.env*` while allowing `.env.example`; do not display `.env.local` contents.
- [x] Use localhost as a development fallback only; return a safe configuration message in production if `NEXT_PUBLIC_SITE_URL` is unset.

### Task 2: Create cookie-aware clients and session refresh

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/proxy.ts`
- Create: `proxy.ts`

**Consumes:** Installed Supabase packages and the public Supabase environment variables.

**Produces:**
- `createClient()` in `lib/supabase/client.ts`, returning the browser Supabase client.
- `createClient()` in `lib/supabase/server.ts`, returning a cookie-backed server client using Next.js `cookies()`.
- `updateSession(request: NextRequest)` in `lib/supabase/proxy.ts`, refreshing auth cookies and returning a `NextResponse`.
- Root `proxy(request)` forwarding requests to `updateSession` with a matcher excluding Next.js static/image assets and common public image files.

- [x] Implement the browser helper using `createBrowserClient` and only the two `NEXT_PUBLIC_` variables.
- [x] Implement the server helper using `createServerClient` and `cookies()`; support cookie reads and writes as required by the current Next.js API.
- [x] Implement the proxy helper using `getClaims()` to refresh the session and propagate refreshed cookies to both request and response.
- [x] Add root `proxy.ts` using the exact Next.js 16 `proxy` export convention.

Client helper shape:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

The server helper must obtain `const cookieStore = await cookies()` and pass `getAll`/`setAll` adapters to `createServerClient`. The proxy must call `supabase.auth.getClaims()`, update request cookies before continuing, copy refreshed cookies onto the response, and return that response. Do not use `getSession()` to authorize a request.

### Task 3: Add server auth actions and a safe callback

**Files:**
- Create: `app/auth/actions.ts`
- Create: `app/auth/callback/route.ts`

**Consumes:** `createClient()` from `lib/supabase/server.ts` and `NEXT_PUBLIC_SITE_URL`.

**Produces:** Server actions with serializable results:
- `signUp(formData: FormData): Promise<{ error: string | null; message: string | null }>`
- `signIn(formData: FormData): Promise<{ error: string | null }>`; redirect to `/` on success.
- `signOut(): Promise<void>`
- `requestPasswordReset(formData: FormData): Promise<{ error: string | null; message: string | null }>`
- `updatePassword(formData: FormData): Promise<{ error: string | null; message: string | null }>`; redirect to `/login?reset=success` on success.
- Callback route exchanges `code` for a cookie session, then redirects to a validated local path.

- [x] Parse `email`, `password`, and `confirmPassword` fields from `FormData`; reject missing/invalid email, short passwords, and mismatched confirmation before making an Auth request.
- [x] Implement signup with `auth.signUp`, setting `emailRedirectTo` to `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/`; redirect to `/` if Supabase returns a session, otherwise return a check-your-email message.
- [x] Implement signin with `auth.signInWithPassword`; return a non-sensitive plain-language error on failure.
- [x] Implement signout with `auth.signOut` and redirect to `/login`.
- [x] Implement password reset request with `auth.resetPasswordForEmail` and redirect to `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`; return the same success message for any syntactically valid address.
- [x] Implement password change with `auth.updateUser({ password })`; return success only after Supabase confirms the update.
- [x] In the callback route, exchange the single-use code using `auth.exchangeCodeForSession(code)`.
- [x] Allow only `next=/` or `next=/reset-password`; redirect every other callback destination to `/`.
- [x] On missing/expired codes or exchange errors, redirect to `/login?error=link-expired` without exposing the code or tokens.

The auth actions should follow this shape and return only display-safe messages:

```ts
export type AuthActionState = { error: string | null; message: string | null };

export async function signIn(formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', message: null };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: 'We could not sign you in with those details.', message: null };
  redirect('/');
}
```

Signup and password update also compare their confirmation fields server-side. Signup redirects to `/` when a session is returned and otherwise returns a check-your-email message. Password update redirects to `/login?reset=success` after success. Password-reset request returns one neutral success message for any valid email unless a general service failure occurs; that failure must not disclose account existence.

### Task 4: Build signup, login, and password recovery screens

**Files:**
- Create: `components/auth/auth-form.tsx`
- Create: `components/auth/password-reset-form.tsx`
- Create: `app/login/page.tsx`
- Create: `app/forgot-password/page.tsx`
- Create: `app/reset-password/page.tsx`
- Modify: `app/globals.css`

**Consumes:** Actions exported by `app/auth/actions.ts`.

**Produces:** Accessible auth forms with loading, success, and error states; responsive forms visually consistent with the existing Orbis styles.

- [x] Create one client auth form that switches between sign-in and signup; require email and password, and require matching confirmation only in signup mode.
- [x] Use `useState` plus `useTransition` around server-action calls; disable submission while pending and render action results near the form.
- [x] Add a **Forgot password?** link from login to `/forgot-password` and a link back to `/login` from each recovery step.
- [x] Build the forgot-password form using `requestPasswordReset`; show a neutral confirmation that does not reveal whether the email is registered.
- [x] Build the reset form using `updatePassword`; require matching new-password fields and handle an invalid/expired recovery session with a link to request a fresh email.
- [x] Add page metadata and focused CSS classes without changing unrelated dashboard styles.

For client forms, prevent the native submit, pass `new FormData(event.currentTarget)` to the corresponding server action inside `startTransition`, and place the returned `message` or `error` in a live status region. Use `aria-describedby` to connect validation feedback to each input.

### Task 5: Protect Orbis and add signed-in account controls

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/orbis-app.tsx`
- Create: `components/auth/sign-out-button.tsx`

**Consumes:** Server client helper, `signOut` action, and existing `OrbisApp` component.

**Produces:** `/` redirects signed-out users before dashboard render; signed-in users see the existing Orbis app with a sign-out control.

- [x] In the server page, call `auth.getClaims()` and redirect to `/login` when no verified user identity exists.
- [x] Keep public auth routes reachable without redirect loops.
- [x] Add a sign-out control to the existing account area, styled for the existing mobile shell and labeled accessibly.
- [x] Show a clear success message after password reset and route the user back to sign-in rather than exposing the protected dashboard on a recovery-only state.

The protected page should perform the check before rendering the client dashboard:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import OrbisApp from '@/components/orbis-app';

export default async function Page() {
  const supabase = await createClient();
  const { data: { claims } } = await supabase.auth.getClaims();
  if (!claims) redirect('/login');
  return <OrbisApp />;
}
```

### Task 6: Update the roadmap and document required Supabase dashboard settings

**Files:**
- Modify: `BUILD_ROADMAP.md`
- Modify: `README.md`

**Consumes:** Completed auth routes and the existing Supabase project configuration.

**Produces:** A project status that states exactly what works locally and what remains for database/RLS work; safe setup notes without secret values.

- [x] Update Phase 1 checkboxes/status to reflect implemented auth while leaving row-level security incomplete until a real user-owned table exists.
- [x] Document the local callback allow-list URL `http://localhost:3000/auth/callback` and the need to add the production callback URL at deployment time.
- [x] Document `pnpm install` and `pnpm dev` startup steps; do not add credential values to README.
- [x] Keep the roadmap's Excel upload topic/provider decision open; this auth task does not implement spreadsheet analysis.

## Manual acceptance checklist

After implementation, use the configured local Supabase project and its email settings to confirm:

1. Signup displays the email-confirmation state when the project requires confirmation.
2. Confirmed users can sign in and remain signed in after a page refresh.
3. A signed-out direct visit to `/` goes to `/login`; auth pages remain accessible.
4. Forgot-password always shows the neutral confirmation for a valid email format.
5. A valid recovery email opens the password reset screen, and the new password can sign in.
6. Expired or reused recovery links show a recoverable error.
7. Sign-out clears access and returns the user to `/login`.
8. No browser-exposed code contains `SUPABASE_SECRET_KEY`.

The Supabase Dashboard must allow `http://localhost:3000/auth/callback` as a redirect URL. If email confirmation or recovery mail does not arrive, check the project's Auth email provider/settings before changing application code.
