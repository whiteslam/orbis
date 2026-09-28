import { type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/security/csp';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  // A fresh nonce per request. Next reads it back out of the Content-Security-Policy
  // request header during rendering and stamps it on its own scripts; the layout
  // reads x-nonce for the inline theme script.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    isDev: process.env.NODE_ENV === 'development',
  });

  const response = await updateSession(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      // Prefetches from next/link don't render HTML, so they need neither a nonce nor a policy.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
