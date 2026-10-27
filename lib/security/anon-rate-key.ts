import { createHmac } from 'node:crypto';

// Who an anonymous request came from, for throttling signed-out writes (the
// waitlist), without ever storing an address.
//
// The client IP is the first hop of x-forwarded-for, which the host (Vercel)
// sets itself, or x-real-ip. Elsewhere a caller can claim any address there, so
// the per-address limit always sits beside a global one that no header changes.
// The key stored is an HMAC of the address under a server secret: a plain hash
// of an IPv4 address can be reversed by trying all four billion of them.
//
// Kept free of Next.js imports so it can be unit tested.

const MAX_IP_LENGTH = 64;
/** Every anonymous caller at once; the backstop the per-address limit can't be dodged around. */
export const ANON_GLOBAL_KEY = 'global';
/** The key for a request that names no address, so all of those share one budget. */
export const ANON_UNKNOWN_KEY = 'unknown';

/** The caller's address from the proxy headers, or null when there isn't a usable one. */
export function clientIpFrom(headers: Pick<Headers, 'get'>): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded || headers.get('x-real-ip')?.trim();
  if (!candidate || candidate.length > MAX_IP_LENGTH || !/^[0-9A-Fa-f.:[\]]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

function keySecret() {
  const lockSecret = process.env.APP_LOCK_SECRET?.trim();
  const base = lockSecret && lockSecret.length >= 32 ? lockSecret : process.env.SUPABASE_SECRET_KEY?.trim();
  if (!base) throw new Error('Anonymous rate limiting is not configured. Set APP_LOCK_SECRET or SUPABASE_SECRET_KEY.');
  return createHmac('sha256', base).update('orbis-anon-rate-key-v1').digest('base64url');
}

/** The stored bucket key for this address: 32 hex characters, never the address itself. */
export function anonRateKey(ip: string | null, secret = keySecret()) {
  if (!ip) return ANON_UNKNOWN_KEY;
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}
