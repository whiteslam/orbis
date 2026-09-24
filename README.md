# Orbis — Personal Intelligence System

Orbis is a personal intelligence workspace with Supabase email/password authentication, owner-scoped finance data, a read-only Gmail connection flow, and a private workbook-to-advice experience.

## Included
- Phone-frame web application shell
- Home / AI board
- Finance tab with owner-scoped transaction data and Gmail transaction-alert connection states
- Health tab with bounded Excel/PDF preview and data-grounded AI advice
- User-managed context notes, a private editable personal profile and fitness persona, investment holdings, goals, and habits
- Responsive full-screen mobile mode
- Reusable components with owner-scoped storage

## Run
```bash
pnpm install
pnpm dev
```

Open http://localhost:3000

## Supabase Auth

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Set `NEXT_PUBLIC_SITE_URL` to `http://localhost:3000` locally and to the app's canonical HTTPS origin in production. The local callback URL `http://localhost:3000/auth/callback` must be allowed in the Supabase project's Auth redirect URL settings for signup confirmation and password recovery links to return to this app; add the production callback URL when deploying. Keep `SUPABASE_SECRET_KEY` server-only. Never commit `.env.local`.

## Passkeys and app lock

Orbis supports passkey sign-in (Face ID, Touch ID, fingerprint or device PIN) through Supabase Auth's WebAuthn support. Supabase runs and verifies the ceremony, and Orbis never receives biometric data. In the Supabase dashboard, open Authentication and enable Passkeys. Set the relying party ID to the production domain (for example `orbis-starter.vercel.app`), and allow the origins `https://orbis-starter.vercel.app` and `http://localhost:3000`. A passkey only works on the domain it was created for, so passkeys made in production do not work on localhost.

After 5 minutes without activity, or when the app returns from the background after that long, Orbis locks. The lock is enforced on the server. While locked, the home page renders only the lock screen and every data action refuses to run. Unlocking needs a passkey or the account password, checked through a fresh authentication entry in the Supabase JWT. The unlock state is an httpOnly cookie signed with `APP_LOCK_SECRET`, generated with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Without that variable, the key is derived from `SUPABASE_SECRET_KEY`, so set it explicitly in production. Unit tests: `node --test --experimental-strip-types lib/security/unlock-token.test.ts`.

## Gmail OAuth setup

Gmail is a separate Google connection; Supabase's **OAuth Server** setting is not required. Enable the Gmail API in the Google Cloud project for the supplied Web OAuth client, then add this exact **Authorized redirect URI** to that client:

```text
http://localhost:3000/auth/gmail/callback
```

The supplied OAuth JSON currently authorizes `http://Orbis.ractrotech.com` only, so the local callback must be added in Google Cloud before connecting Gmail locally. Add the client ID and secret to ignored `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; set `GOOGLE_REDIRECT_URI` to the callback above; and set `GMAIL_TOKEN_ENCRYPTION_KEY` to a fresh base64-encoded 32-byte key (for example, generate one with `openssl rand -base64 32`). Never copy credential values into this README or `.env.example`.

Google consent screen configuration must include your account as a test user while the app is in testing mode. Orbis requests the restricted `gmail.readonly` scope, so Google verification and potentially a security assessment may be required before public production use.

## Apply the Finance and Gmail schema

After signing in to the Supabase Dashboard, open **SQL Editor** and run migrations in filename order: `202609240001_finance_gmail.sql` through `202609240012_health_steps.sql`. Until these migrations are applied, the corresponding Finance/Gmail, workbook advice, transaction review, Goals/Habits, saved-context, Investment, aggregate AI event logging, fitness persona, personal profile, manual transaction, portfolio AI, and Apple Health steps features are unavailable.

## Workbook advice

The Health tab accepts `.xlsx` and text-based `.pdf` files up to 100 MB; CSV and older `.xls` files are not supported. PDF previews are limited to 50 pages, 20,000 text items, and 120,000 extracted characters. Scanned image-only PDFs are not supported yet. XLSX archives are expanded through a capped streaming check before workbook parsing; spreadsheet limits also cap sheets, rows, columns, cells, and preview size. Orbis parses files in memory, shows a bounded preview and extracted observations, and does not save uploaded content or generated advice. Excel advice requires at least three numeric values in a column; PDF advice is grounded in bounded extracted text snippets. Every recommendation shown must cite a detected observation. Only after you request advice and confirm the disclosure does Orbis send a bounded summary (not the original file) to OpenRouter. Saved context notes are excluded unless you separately opt in; when enabled, Orbis ranks a bounded set of your notes against document content, then includes up to five notes with a 3,000-character cap. Your personal profile is excluded unless you separately opt in for that request; the disclosure names its preferred name, role, and “More about me” text. Your saved fitness persona is sent only after a separate opt-in, and only for a health or fitness document. Each account has five advice attempts per UTC day; provider errors also count as attempts. Migrations 007–009 add content-free AI attempt metadata, the private fitness persona, and the private personal profile; these tables do not store uploaded files or generated advice. Set `OPENROUTER_API_KEY` as a server-only variable. The code default is `openai/gpt-4o-mini`; set `OPENROUTER_MODEL` to override it. The current local and production configuration selects `nvidia/nemotron-3-ultra-550b-a55b`. Advice is informational and should not be treated as medical diagnosis or guaranteed financial guidance.

The Personal tab includes an editable starter fitness persona based on a historical 2021 plan. Save it to your private account after applying migration 008. It treats old measurements and calorie targets as historical, not current. The persona is not sent to OpenRouter unless you opt in for an individual health/fitness workbook request.

The Personal tab also includes an account-private profile for your preferred name, work or role, and up to 3,000 characters of background and preferences. The preferred name appears in the Home greeting. The profile is sent to OpenRouter only when you opt in for an individual workbook request; apply migration 009 before saving it.

The live production app is [orbis-starter.vercel.app](https://orbis-starter.vercel.app). Sign-in and connected data features require the Supabase migrations and OAuth redirect allowlists described below.

The project directory currently uses `.env.local` for local credentials and is ignored by both Git and `.vercelignore`. For Vercel, add the Supabase URL, publishable key, secret key, site URL, OpenRouter key, and Gmail OAuth/encryption values in the Vercel project's server environment before enabling those features. Set `NEXT_PUBLIC_SITE_URL` and `GOOGLE_REDIRECT_URI` to the deployed HTTPS origin and add the corresponding callback URLs to Supabase and Google. Do not pull production secrets into a file that may be committed.

## Next build order
1. Supabase Auth; add owner-scoped RLS alongside each real user-owned data table
2. Finance schema + Gmail OAuth sync
3. Deterministic transaction parser
4. Health onboarding + Excel ingestion and advice
5. User-managed context notes and explicit opt-in to AI advice
6. OpenRouter AI gateway and request budget
7. Daily Orbis Brief from confirmed user data
8. Manual investment holdings tracker

## Environment variables
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=
APP_LOCK_SECRET=
NEXT_PUBLIC_SITE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/gmail/callback
GMAIL_TOKEN_ENCRYPTION_KEY=
OPENROUTER_API_KEY=
```
