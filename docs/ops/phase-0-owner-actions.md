# Phase 0 owner actions

What only you can do before Orbis is opened to other people. The code is on branch `android-agent`; nothing here happens automatically. Do them in this order.

1. **Apply the three migrations** in the Supabase SQL editor (or `supabase db push --include-all`), in filename order, any time before you deploy this branch. All are additive and safe to run twice.
   - `202611120001_user_settings.sql`
   - `202611120002_account_roles.sql`
   - `202611120003_plans.sql`

2. **Make yourself the owner and put yourself on the owner plan** (SQL editor, your own address). Without the second statement the owner plan is unused.

   ```sql
   insert into public.account_roles (user_id, role)
   select id, 'owner' from auth.users where email = '<owner email>'
   on conflict (user_id) do update set role = excluded.role;

   insert into public.account_plans (user_id, plan_id)
   select id, 'owner' from auth.users where email = '<owner email>'
   on conflict (user_id) do update set plan_id = excluded.plan_id;
   ```

3. **Create a staging Supabase project** and set `ORBIS_PRODUCTION_SUPABASE_URL` in your `.env.local` to the production URL, so `pnpm test:e2e` refuses to run against production. Steps are in [`staging.md`](./staging.md).

4. **Run the two e2e specs that were written but never run**, once, against staging: `tests/e2e/locale/time-zone.spec.ts` and `tests/e2e/onboarding/first-run.spec.ts`. Expect to fix small things. Never run them against production.

5. **Google sign-in (optional).** In the Google Cloud console create an OAuth client (web). In Supabase Authentication -> Providers, enable Google with that client's ID and secret, and add the callback URL Supabase shows to the Google client's authorised redirect URIs. Also allow `<your site>/auth/callback` under Authentication -> URL Configuration. Then set `ORBIS_GOOGLE_SIGNIN=true`. Keep it off while sign-up is closed.

6. **Sentry (optional).** Create a Sentry project and set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (the same DSN) in the deployment. Leave them unset for no error reporting.

7. **Review the draft privacy policy and terms** (`app/privacy/page.tsx`, `app/terms/page.tsx`) and fill the blanks: the operator's legal name, the grievance officer and response time, the hosting regions, and the backup window. Also check the claims about send scopes (Gmail send, Meta publish), the Google Calendar scope that nothing uses yet, and `/delete-account` saying "nothing is kept" while backups exist.

8. **Fix the "never trains AI on your data" claims, or restore the rule.** Since 2026-10-27 the router no longer keeps personal requests to providers that do not train (`lib/ai/router.ts`), so these are false today:
   - `components/marketing/waitlist-screen.tsx` (landing page)
   - `app/layout.tsx` (site description)
   - `app/support/page.tsx` (FAQ "Does the AI train on my data?")
   - consent checkboxes: `components/health/workbook-advisor.tsx`, `components/money/portfolio-ai.tsx`, `components/social/ai-draft-dialog.tsx`
   - `lib/providers/status.ts` ("Routed to providers that don't train on your data")

   Either reword them to match `/privacy`, or restore the rule by filtering candidates on `may_train` again in `lib/ai/router.ts`.

9. **Decide the four service-role "needs owner decision" items** in [`../security/service-role-uses.md`](../security/service-role-uses.md). Each reads a person's own content with the service role on a request path; switching needs a migration or refactor. The doc recommends keeping the first and last.
   - `app/career/actions.ts` ("Search now")
   - `app/personal/notification-actions.ts` ("Send a test")
   - `lib/health-docs/repository.ts` (health document passages)
   - `lib/storage/signed-upload.ts` (signed-upload read-back)

10. **When ready to open sign-up**, turn on Supabase Authentication -> "Allow new users to sign up" and set `ORBIS_OPEN_SIGNUPS=true` together, then redeploy. Supabase's switch is the real door; keep it off until this step.
