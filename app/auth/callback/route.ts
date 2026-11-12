import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unlockWithFreshAuth } from '@/lib/security/app-lock';
import { UNLOCK_METHODS, signedInWithOAuth } from '@/lib/security/unlock-token';
import { accessAllowed, signupsOpen } from '@/lib/security/access';
import { shouldRefuseNewAccount } from '@/lib/security/new-account';
import { OAUTH_START_COOKIE, verifyFlowStart } from '@/lib/security/oauth-start';
import { createAdminClient } from '@/lib/supabase/admin';

const allowedDestinations = new Set(['/active', '/reset-password']);

/** Deletes the account; if that fails, bans it so a later sign-in can't get in either. */
async function removeNewAccount(userId: string) {
  const admin = createAdminClient();
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return;
    console.error('auth callback: could not delete a new account', error.status ?? error.code);
  } catch (caught) {
    console.error('auth callback: could not delete a new account', caught instanceof Error ? caught.name : 'unknown');
  }
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (error) console.error('auth callback: could not ban a new account', error.status ?? error.code);
  } catch (caught) {
    console.error('auth callback: could not ban a new account', caught instanceof Error ? caught.name : 'unknown');
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/active';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=link-expired', request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=link-expired', request.url));
  }

  // A confirmation or recovery link mints a session without going through
  // signIn, so the door has to be here too. An unlisted address is signed
  // straight back out rather than left holding a valid session.
  const { data: claims } = await supabase.auth.getClaims(data.session?.access_token);
  const email = typeof claims?.claims?.email === 'string' ? claims.claims.email : null;
  if (!accessAllowed(email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=private', request.url));
  }

  // Second line of defence while sign-ups are closed. The authoritative door
  // is Supabase Auth's "Allow new users to sign up" switch, which must stay OFF
  // while ORBIS_OPEN_SIGNUPS is off (turn both on together): this callback can
  // be bypassed by exchanging the code at Supabase directly.
  //
  // This covers Google/OAuth sign-ins only: a first Google sign-in makes
  // Supabase create an account. If this session's account was created by the
  // flow now finishing (judged from the signed cookie set when it began; see
  // isNewAccount), remove it and turn the person away. Existing accounts are
  // left alone, and email links (confirmation, invite, magic link, recovery)
  // skip this check, so an account the owner creates or invites works.
  const cookieStore = await cookies();
  const flowStartedAt = verifyFlowStart(cookieStore.get(OAUTH_START_COOKIE)?.value);
  cookieStore.delete(OAUTH_START_COOKIE);
  const user = data.session?.user;
  if (user && shouldRefuseNewAccount({ signupsOpen: signupsOpen(), oauth: signedInWithOAuth(claims?.claims?.amr), createdAt: user.created_at, flowStartedAt, now: new Date() })) {
    await removeNewAccount(user.id);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=private', request.url));
  }

  const destination = allowedDestinations.has(next) ? next : '/active';
  if (destination === '/active' && data.session) {
    // A confirmed email link is a fresh sign-in, so open Orbis unlocked.
    const { data: fresh } = await supabase.auth.getClaims(data.session.access_token);
    // Google arrives with an 'oauth' method in the session's amr, a link from
    // an email with otp/magiclink/email-signup; each unlocks only on its own kind.
    const methods = signedInWithOAuth(fresh?.claims?.amr) ? UNLOCK_METHODS.oauth : UNLOCK_METHODS.emailLink;
    await unlockWithFreshAuth(fresh?.claims, methods);
  }
  return NextResponse.redirect(new URL(destination, request.url));
}
