// The phone's own requests (sync, and signing itself out) authenticate with its device
// credential, never a person's session. On Android, Capacitor's cookie handler is
// process-wide, so these requests can carry the WebView's Supabase cookies too. If the
// proxy ran its session refresh on them, the background sync would join refresh-token
// rotation alongside the WebView (plan ruling P1 forbids that, and a lost race signs the
// person out). proxy.ts therefore passes them straight through, before updateSession.

const DEVICE_AUTH = 'Device ';

/**
 * True for a request the proxy must pass through without touching the session:
 * POST /api/device/signals (device credential only), and /api/device/revoke when it
 * carries `Authorization: Device …`. The web's cookie revoke (removing a phone from
 * Settings) and /api/device/register are ordinary signed-in requests and keep the refresh.
 */
export function skipsSessionRefresh(pathname: string, authorization: string | null): boolean {
  if (pathname === '/api/device/signals') return true;
  return pathname === '/api/device/revoke' && authorization?.startsWith(DEVICE_AUTH) === true;
}
