/**
 * Who is allowed into this installation at all.
 *
 * A private build needs a door that shuts without touching Supabase's own
 * settings or the database: set ORBIS_ALLOWED_EMAILS and only those addresses
 * get in, clear it and the app is open again. Nothing about it is committed,
 * so who is allowed is deployment configuration rather than source.
 *
 * Client-safe: reads an environment variable and compares strings.
 */

/** Everyone listed, lowercased. Empty means the app is open to anyone. */
export function allowedEmails(): string[] {
  return (process.env.ORBIS_ALLOWED_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** True while the installation is restricted to a list. */
export function accessRestricted() {
  return allowedEmails().length > 0;
}

/**
 * Whether this address may sign in.
 *
 * An unknown address is refused while the list is set, including one with no
 * email at all: a session that cannot be attributed is not one to trust.
 */
export function accessAllowed(email: string | null | undefined) {
  const allowed = allowedEmails();
  if (!allowed.length) return true;
  const address = email?.trim().toLowerCase();
  return Boolean(address) && allowed.includes(address as string);
}

/**
 * Whether anyone may create an account here.
 *
 * Deliberately the opposite way round from the allowlist. An empty
 * ORBIS_ALLOWED_EMAILS has to mean "sign-in is open", because that is how the
 * test suite signs in as throwaway users; but letting it also mean "anyone may
 * create an account" made a forgotten environment variable the only thing
 * between a stranger and a new account on a personal installation. So sign-up
 * stays shut unless it is opened on purpose, with ORBIS_OPEN_SIGNUPS=true, and
 * an allowlist shuts it regardless: adding yourself to the list is not a
 * self-service action.
 */
export function signupsOpen() {
  return !accessRestricted() && process.env.ORBIS_OPEN_SIGNUPS?.trim().toLowerCase() === 'true';
}

/** What someone turned away is told. It does not hint at who is on the list. */
export const ACCESS_DENIED_MESSAGE = 'Orbis is private right now and not accepting sign-ins.';

/** The same, for someone trying to create an account. */
export const SIGNUP_CLOSED_MESSAGE = 'Orbis is private right now and not accepting new accounts.';
