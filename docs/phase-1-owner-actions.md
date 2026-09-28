# Phase 1 owner actions

Steps only the project owner can do — Vercel and Supabase dashboard settings, running migrations, and legal copy. None of this is enforceable from code, so nothing here happens automatically. Roughly in the order you'd want to do it.

## Before deploying this branch

1. **Set `ORBIS_ALLOWED_EMAILS` in Vercel now, or deliberately decide to leave sign-up open.** Sign-up is currently open on production. Either set the variable to close it to a known list of addresses, or make a deliberate call to leave it open only after you've reviewed the legal pages (`/privacy`, `/terms`) below. Either way, check **Supabase → Authentication → Users** for accounts you don't recognize before doing anything else.

2. **Apply the Phase 1 migrations, in order, before deploying this branch:**
   - `202609280200_hardening.sql`
   - `202609280201_rate_limits.sql`
   - `202609280202_staged_upload_claims.sql`
   - `202609280203_ai_consent.sql`

   Rate limits fail closed: uploads, file parsing and Gmail sync are refused entirely until `0201` and `0202` exist. AI stays off for every account until `0203` exists, independent of any provider key you've set.

3. **After deploy, switch AI on once, in Profile → Settings.** AI is off by default for every account — that's the consent step, not a bug. Until someone turns it on, Home falls back to wording Orbis wrote itself and AI features say AI is off, even with provider keys configured.

4. **In the Supabase dashboard, enable "Secure password change" and "Leaked password protection"** (Authentication → Policies / Settings, naming varies by dashboard version). This closes a gap Orbis's own code can't close from the outside: without it, a stolen session could call Supabase's password-update API directly, bypassing the app's fresh-auth requirement.

5. **Set `NEXT_PUBLIC_SUPPORT_EMAIL`**, and a custom domain plus `NEXT_PUBLIC_SITE_URL` when you're ready to move off the default Vercel domain. Review the privacy and terms text on `/privacy` and `/terms` — ideally with a lawyer — before relying on them.

6. **Pin the Vercel function region to your Supabase project's region.** Mismatched regions add latency to every database round trip; this is a Vercel project setting, not something the app can set for itself.

## After deploying

7. **Open one real password-recovery link and confirm the "Current password" field is not shown.** That's the recovery-sign-in path working correctly (`app/auth/actions.ts`); if it appears, something about the recovery session isn't being recognized as fresh. Separately: any Gmail connect that was mid-flow at the moment of deploy will fail once, because the OAuth state key changed — that's expected, just retry the connection.

8. **Do a staging run of account deletion before relying on it with real users.** Confirm the storage walk (`lib/account/storage.ts`) actually finds and removes files across all the buckets it's supposed to, and that deleting the `auth.users` row cascades through every table it should. This only needs to be checked once per schema change, but check it before the first real user deletes their account.

## Before merging the other session's work (Ask Orbis, voice notes, edit history)

9. That work is unmerged in a separate session as of this writing. Before merging it in:
   - Add its user-owned tables to `EXPORT_TABLES` (`lib/account/deletion-plan.ts`) and confirm they cascade on account deletion the same way the Phase 1 tables do.
   - Add Ask Orbis to the AI disclosure copy, and make sure it checks `aiAllowed`/consent before spending any quota — the same gate every other AI feature goes through in `lib/ai/router.ts`.
   - Confirm its code never writes `ai_results`, `notification_log` or `push_subscriptions` with the user-scoped client — `202609280200_hardening.sql` narrowed those grants so only the service role can write them; a user-client write will now fail, which is the point, but double-check nothing relies on the old behavior.
   - Rename the Profile "AI brief" settings group to "AI" once Ask Orbis is in it — the group covers more than the brief at that point.

## Ongoing

10. **`pnpm test:e2e` creates real user accounts in whatever Supabase project your environment points at.** Point it at a separate, disposable Supabase project — never at production — before running it.
