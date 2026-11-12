// Whether a session belongs to an account that was created a moment ago, by this very sign-in.
// Pure so it can be tested without the server.

/** An account made no longer ago than this counts as just created. */
const NEW_ACCOUNT_WINDOW_MS = 120_000;
/** First sign-in must follow creation within this, or the account has been used before. */
const FIRST_SIGN_IN_WINDOW_MS = 5_000;

/**
 * True when the account was created within two minutes of `now` and was first
 * signed into within five seconds of being created. Anything unreadable is
 * false: an account is never treated as disposable on a guess.
 */
export function isBrandNewAccount(createdAt: string | undefined, lastSignInAt: string | undefined, now: Date): boolean {
  if (!createdAt || !lastSignInAt) return false;
  const created = Date.parse(createdAt);
  const signedIn = Date.parse(lastSignInAt);
  if (Number.isNaN(created) || Number.isNaN(signedIn)) return false;
  const age = now.getTime() - created;
  if (age < 0 || age > NEW_ACCOUNT_WINDOW_MS) return false;
  const gap = signedIn - created;
  return gap >= 0 && gap <= FIRST_SIGN_IN_WINDOW_MS;
}
