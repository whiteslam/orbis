import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unlockWithFreshAuth } from '@/lib/security/app-lock';
import { UNLOCK_METHODS, signedInWithOAuth } from '@/lib/security/unlock-token';
import { accessAllowed, signupsOpen } from '@/lib/security/access';
import { isBrandNewAccount } from '@/lib/security/new-account';
import { createAdminClient } from '@/lib/supabase/admin';

const allowedDestinations = new Set(['/active', '/reset-password']);

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

  // Sign-up is shut, yet a link or a Google sign-in can still mint an account
  // (Supabase creates one on a first Google sign-in). If this session belongs
  // to an account created a moment ago, remove it and turn the person away. An
  // account that already existed, or an email link clicked later than a couple
  // of minutes after sign-up, is left alone.
  const user = data.session?.user;
  if (user && !signupsOpen() && isBrandNewAccount(user.created_at, user.last_sign_in_at, new Date())) {
    try {
      const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(user.id);
      if (deleteError) console.error('auth callback: could not remove a new account', deleteError.status ?? deleteError.code);
    } catch (caught) {
      console.error('auth callback: could not remove a new account', caught instanceof Error ? caught.name : 'unknown');
    }
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
