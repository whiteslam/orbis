// Turns WebAuthn / Supabase passkey errors into short messages. Returns null when the user simply cancelled.
export function passkeyErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return 'Device authentication failed. Try again or use your password.';
  const { code, name, cause } = error as { code?: unknown; name?: unknown; cause?: unknown };
  const causeName = cause && typeof cause === 'object' ? (cause as { name?: unknown }).name : undefined;

  if (code === 'ERROR_CEREMONY_ABORTED' || name === 'AbortError' || name === 'NotAllowedError' || causeName === 'NotAllowedError' || causeName === 'AbortError') return null;
  if (code === 'webauthn_challenge_expired') return 'That request timed out. Try again.';
  if (code === 'passkey_disabled') return 'Face ID and passkey sign-in are not switched on for Orbis yet. Use your password for now.';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has an Orbis passkey.';
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID') return 'Passkeys are not set up for this address yet.';
  if (code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' || code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT') {
    return 'This device cannot store a passkey. Use your password instead.';
  }
  return 'Device authentication failed. Try again or use your password.';
}

export function supportsPasskeys() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}
