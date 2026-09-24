import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unlockWithFreshAuth } from '@/lib/security/app-lock';

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

  const destination = allowedDestinations.has(next) ? next : '/';
  if (destination === '/' && data.session) {
    // A confirmed email link is a fresh sign-in, so open Orbis unlocked.
    const { data: fresh } = await supabase.auth.getClaims(data.session.access_token);
    await unlockWithFreshAuth(fresh?.claims);
  }
  return NextResponse.redirect(new URL(destination, request.url));
}
