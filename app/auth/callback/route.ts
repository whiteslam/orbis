import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unlockWithFreshAuth } from '@/lib/security/app-lock';
import { accessAllowed } from '@/lib/security/access';

const allowedDestinations = new Set(['/', '/reset-password']);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

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

  const destination = allowedDestinations.has(next) ? next : '/';
  if (destination === '/' && data.session) {
    // A confirmed email link is a fresh sign-in, so open Orbis unlocked.
    const { data: fresh } = await supabase.auth.getClaims(data.session.access_token);
    await unlockWithFreshAuth(fresh?.claims);
  }
  return NextResponse.redirect(new URL(destination, request.url));
}
