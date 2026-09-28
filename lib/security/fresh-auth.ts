// Who may change the account password, and when. Pure, so it can be unit tested.
//
// A recovery (or one-time code) sign-in in the last 15 minutes is proof the
// person holds the mailbox, which is what a password reset is for. Anything
// else is an ordinary session, possibly on a device left open, so it must also
// know the current password and have Orbis unlocked on this device.

export const RECOVERY_WINDOW_SEC = 15 * 60;
/** The shortest password Orbis accepts for a new account or a new password. */
export const MIN_PASSWORD_LENGTH = 10;
const FRESH_METHODS = new Set(['recovery', 'otp']);

export type PasswordChangeCheck = { ok: true } | { ok: false; needs: 'current-password' | 'unlock' };

/**
 * True when the JWT's `amr` claim records a recovery or OTP sign-in within the
 * window. Reads `amr` the same way `hasFreshAuth` does: only timestamped entries
 * count, so a refreshed token keeps its original timestamps and never looks fresh.
 */
export function hasFreshRecovery(amr: unknown, nowSec: number, maxAgeSec = RECOVERY_WINDOW_SEC) {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !FRESH_METHODS.has(method)) return false;
    return typeof timestamp === 'number' && timestamp <= nowSec + 5 && nowSec - timestamp <= maxAgeSec;
  });
}

export function canChangePassword(input: { amr: unknown; nowSec: number; unlocked: boolean; currentPasswordVerified: boolean }): PasswordChangeCheck {
  if (hasFreshRecovery(input.amr, input.nowSec)) return { ok: true };
  // The lock is checked first, so a locked device can't be used to test passwords.
  if (!input.unlocked) return { ok: false, needs: 'unlock' };
  if (!input.currentPasswordVerified) return { ok: false, needs: 'current-password' };
  return { ok: true };
}
