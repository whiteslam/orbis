import 'server-only';

import { isAppUnlocked } from '@/lib/security/app-lock';
import { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;
export type Claims = NonNullable<Awaited<ReturnType<ServerClient['auth']['getClaims']>>['data']>['claims'];

export type SignedInSession = { supabase: ServerClient; userId: string; claims: Claims };

/**
 * The signed-in person, verified from the session's claims, whether or not
 * Orbis is unlocked on this device. Only for callers that must tell "locked"
 * apart from "signed out" (the unlock screen, account deletion); everything
 * else uses requireUser().
 */
export async function signedInSession(): Promise<SignedInSession | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== 'string') return null;
  return { supabase, userId: claims.sub, claims };
}

/**
 * The one sign-in gate for server actions and routes: the user comes from
 * `getClaims()`, never from the browser, and a locked Orbis counts as signed out
 * until it is unlocked.
 */
export async function requireUser(): Promise<SignedInSession | null> {
  const session = await signedInSession();
  if (!session || !(await isAppUnlocked(session.claims))) return null;
  return session;
}

/** The signed-in user's id, or null. Kept for the routes that only need the id. */
export async function getAuthenticatedUserId(): Promise<string | null> {
  return (await requireUser())?.userId ?? null;
}

/** The lower-cased email in the claims, if there is one. */
export function claimsEmail(claims: Claims): string | null {
  return typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
}
