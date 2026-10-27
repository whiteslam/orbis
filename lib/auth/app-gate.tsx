import 'server-only';

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { LockScreen } from '@/components/security/lock-screen';
import { PinSetup } from '@/components/security/pin-setup';
import { accessAllowed } from '@/lib/security/access';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { getPinStatus } from '@/lib/security/pin-store';
import { createClient } from '@/lib/supabase/server';

export type AppGate =
  | { open: true; userId: string; email: string | null }
  | { open: false; render: ReactNode };

/**
 * The door every signed-in page goes through: a session, an address on the
 * list, Orbis unlocked on this device and a device PIN set. Shared by /active
 * and /active/career so the two can't drift apart. Redirects a stranger to the
 * sign-in form; returns the lock or PIN screen to render instead of the page;
 * otherwise the person, and only then may the page load anything personal.
 */
export async function appGate(): Promise<AppGate> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  // A stranger gets the sign-in form, not a hint that this is where Orbis lives.
  if (error || !data?.claims) redirect('/login');

  const userId = data.claims.sub;
  if (typeof userId !== 'string') redirect('/login');

  const email = typeof data.claims.email === 'string' ? data.claims.email.toLowerCase() : null;

  // Closing the door does not evict whoever is already inside, and a Supabase
  // session outlives a sign-in. Checked on every load of the app, so removing
  // an address from the list takes effect on their next request rather than
  // whenever their token happens to expire.
  if (!accessAllowed(email)) {
    await supabase.auth.signOut();
    redirect('/login?error=private');
  }

  // While locked, load nothing personal: only the lock screen is rendered.
  // The two checks are independent, so neither waits for the other.
  const [pinStatus, unlocked] = await Promise.all([getPinStatus(userId), isAppUnlocked(data.claims)]);
  if (!unlocked) return { open: false, render: <LockScreen pinStatus={pinStatus} /> };
  // A device PIN is required before Orbis opens; 'unavailable' (migration not applied) skips it rather than blocking.
  if (pinStatus === 'none' || pinStatus === 'locked') return { open: false, render: <PinSetup reset={pinStatus === 'locked'} /> };

  return { open: true, userId, email };
}
