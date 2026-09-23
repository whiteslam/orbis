# Orbis — Personal Intelligence System

Orbis is a personal intelligence workspace with Supabase email/password authentication, owner-scoped finance data, a read-only Gmail connection flow, and a private workbook-to-advice experience.

## Included
- Phone-frame web application shell
- Home / AI board
- Finance tab with owner-scoped transaction data and Gmail transaction-alert connection states
- Health tab with bounded Excel/CSV preview and data-grounded AI advice
- User-managed context notes, investment holdings, goals, and habits
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

## Gmail OAuth setup

Gmail is a separate Google connection; Supabase's **OAuth Server** setting is not required. Enable the Gmail API in the Google Cloud project for the supplied Web OAuth client, then add this exact **Authorized redirect URI** to that client:

```text
http://localhost:3000/auth/gmail/callback
```

The supplied OAuth JSON currently authorizes `http://Orbis.ractrotech.com` only, so the local callback must be added in Google Cloud before connecting Gmail locally. Add the client ID and secret to ignored `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; set `GOOGLE_REDIRECT_URI` to the callback above; and set `GMAIL_TOKEN_ENCRYPTION_KEY` to a fresh base64-encoded 32-byte key (for example, generate one with `openssl rand -base64 32`). Never copy credential values into this README or `.env.example`.

Google consent screen configuration must include your account as a test user while the app is in testing mode. Orbis requests the restricted `gmail.readonly` scope, so Google verification and potentially a security assessment may be required before public production use.

## Apply the Finance and Gmail schema

After signing in to the Supabase Dashboard, open **SQL Editor** and run migrations in filename order: `202609240001_finance_gmail.sql` through `202609240007_ai_generation_events.sql`. Until these migrations are applied, the corresponding Finance/Gmail, workbook advice, transaction review, Goals/Habits, saved-context, Investment, and aggregate AI event logging features are unavailable.

## Workbook advice

The Health tab accepts `.xlsx` and `.csv` files up to 1.5 MB. XLSX archives are expanded through a capped streaming check before workbook parsing; workbook limits also cap sheets, rows, columns, cells, and preview size. Orbis parses them in memory, shows the detected rows and calculated numeric observations, and does not save workbook content or advice. Advice requires at least three numeric values in a column and every recommendation shown must cite a detected observation. Only after you request advice and confirm the disclosure does Orbis send a bounded summary (not the original workbook) to OpenRouter. Saved context notes are excluded unless you separately opt in; when enabled, Orbis ranks a bounded set of your notes against workbook sheet/column names, then includes up to five notes with a 3,000-character cap. Each account has five advice attempts per UTC day; provider errors also count as attempts. After migration 007, Orbis stores content-free operational metadata about each provider attempt (outcome, model, status, response size, and duration). Set `OPENROUTER_API_KEY` as a server-only variable. The default model is `openai/gpt-4o-mini`; set `OPENROUTER_MODEL` to override it. Advice is informational and should not be treated as medical diagnosis or guaranteed financial guidance.

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
NEXT_PUBLIC_SITE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/gmail/callback
GMAIL_TOKEN_ENCRYPTION_KEY=
OPENROUTER_API_KEY=
```
