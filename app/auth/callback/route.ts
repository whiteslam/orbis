import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const allowedDestinations = new Set(['/', '/reset-password']);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=link-expired', request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=link-expired', request.url));
  }

  const destination = allowedDestinations.has(next) ? next : '/';
  return NextResponse.redirect(new URL(destination, request.url));
}
