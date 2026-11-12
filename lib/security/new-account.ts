// Whether a session belongs to an account that this sign-in just created.
// Pure so it can be tested without the server.

/** With no flow-start note, an account made in the last ten minutes counts as new. */
const NO_COOKIE_WINDOW_MS = 10 * 60_000;
/** Clock slack between this server and Supabase when comparing with the flow start. */
const CLOCK_SLACK_MS = 5_000;

/**
 * True when the account looks created by the sign-in that is finishing now.
 *
 * With `flowStartedAt` (from the signed cookie set when Google sign-in began),
 * new means created at or after that moment, give or take clock slack. Without
 * it, new means created within the last ten minutes. A missing or unreadable
 * created_at is treated as new: this check runs only while sign-ups are
 * closed, so when in doubt the account is turned away.
 *
 * last_sign_in_at is deliberately not used: Supabase sets it when Orbis
 * exchanges the code, and the person controls how long that takes.
 */
export function isNewAccount(createdAt: string | undefined, flowStartedAt: Date | null, now: Date): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(created)) return true;
  if (flowStartedAt) return created >= flowStartedAt.getTime() - CLOCK_SLACK_MS;
  return now.getTime() - created <= NO_COOKIE_WINDOW_MS;
}
