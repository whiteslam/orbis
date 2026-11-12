# Staging

A second Supabase project that is not your real data, so tests and trial migrations can run without touching it. Everything below is for you to do; nothing happens automatically.

## Why

`pnpm test:e2e` creates real accounts (two throwaway users, then deletes them) in whichever Supabase project it is pointed at. `.env.local` points at production, so running it as-is would put test users in your real user list. The e2e config now stops with an error if it is about to do that (see "Protect production" below), but staging is where it should run.

## 1. Create the project

1. Supabase dashboard -> New project. Name it `orbis-staging`, pick the same region as production.
2. Leave Authentication settings at their defaults; the tests confirm their own users.
3. Settings -> API: copy the project URL, the publishable key and the secret key. You need all three below.

## 2. Apply the migrations

They live in `supabase/migrations/` and are named so that filename order is the right order. They are safe to run twice.

With the Supabase CLI (install: https://supabase.com/docs/guides/cli):

```
supabase login
supabase link --project-ref <staging project ref>
supabase db push --include-all
```

The ref is the string in the project URL (`https://<ref>.supabase.co`). If the CLI says there is no `supabase/config.toml`, run `supabase init` once and answer no to the extras; it only adds a config file. `--include-all` makes it apply every file, including ones older than the last it has seen.

Check you linked staging, not production, before pushing: `supabase projects list` marks the linked one.

Without the CLI: open each file in `supabase/migrations/` in the SQL editor and run them one at a time, oldest filename first. (`supabase/pending.sql` is an older bundle and does not include the newest migrations, so do not rely on it.)

New in this branch, run after everything older:

| File | What it adds |
| --- | --- |
| `202611120001_user_settings.sql` | Per-person time zone, currency, locale, chosen modules and first-run state. Existing accounts count as onboarded. |
| `202611120002_account_roles.sql` | Who is the owner or an admin. Nobody has a role until you grant one. |
| `202611120003_plans.sql` | Plans that set the daily AI allowance. Everyone is on `free`, which changes nothing. |

Make yourself owner and put yourself on the owner plan (SQL editor, your own address). Do this on production as well once the migrations are there:

```sql
insert into public.account_roles (user_id, role)
select id, 'owner' from auth.users where email = '<owner email>'
on conflict (user_id) do update set role = excluded.role;

insert into public.account_plans (user_id, plan_id)
select id, 'owner' from auth.users where email = '<owner email>'
on conflict (user_id) do update set plan_id = excluded.plan_id;
```

## 3. Point the tests at staging

Create `.env.test.local` in the repo root (it is git-ignored, like every `.env*` file). It overrides `.env.local` for e2e only:

```
NEXT_PUBLIC_SUPABASE_URL=https://<staging ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
SUPABASE_SECRET_KEY=<staging secret key>
```

Set all three together so the keys always match the URL. Everything else (AI keys and so on) still comes from `.env.local`; leave it out of staging unless a test needs it.

## 4. Protect production

Add this line to your `.env.local` (and to your shell profile if you run tests from a plain terminal):

```
ORBIS_PRODUCTION_SUPABASE_URL=https://<production ref>.supabase.co
```

When it equals the Supabase URL the e2e run would use, `pnpm test:e2e` stops straight away with "Refusing to run e2e against production Supabase". Case and a trailing slash are ignored. It is a safety net, not a lock: if the variable is unset, nothing is checked. The public smoke suite (`pnpm test:public`) creates no accounts and is not guarded.

## 5. Run the tests

```
pnpm test:e2e
```

This builds the app, serves it on port 3100, creates two real accounts in staging, runs the suite, and deletes them. If a run is killed part-way, look for leftover `orbis-qa-*@example.com` users in staging (Authentication -> Users) and delete them.

## Optional: error reporting

If you want crashes reported, create a Sentry project (type: Next.js) and set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser, same value is fine) in Vercel. Without them nothing is sent. Reports leave out request bodies, cookies, query strings and sign-in headers. Readable stack traces in Sentry would additionally need source maps uploaded at build time, which needs a Sentry auth token; that is not set up.
