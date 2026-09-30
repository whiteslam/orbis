// The Content-Security-Policy, built per request so scripts can carry a nonce.
//
// style-src keeps 'unsafe-inline' because React style={…} attributes are inline
// styles and the UI uses them for bars and rings; scripts are the attack surface
// CSP exists for, and those are nonce-only with 'strict-dynamic'.
//
// There are two policies, because a policy is also a description. The app's
// names every origin Orbis talks to, which on a public page would answer "what
// does this thing connect to?" for anyone who opened the response headers: the
// Supabase project, Google, Zerodha. The public pages neither need those origins
// nor should mention them, so they get a policy that is both tighter and quieter.
export function buildCsp({ nonce, supabaseUrl, isDev, scope = 'app' }: { nonce: string; supabaseUrl: string; isDev: boolean; scope?: 'app' | 'public' }) {
  const script = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`;
  const shared = [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ];
  const tail = isDev ? [] : ['upgrade-insecure-requests'];

  if (scope === 'public') {
    // A waitlist, some legal text and the offline page: same-origin only, and a
    // form that posts nowhere but here.
    return [
      ...shared,
      "img-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self'",
      "form-action 'self'",
      ...tail,
    ].join('; ');
  }

  const supabase = supabaseUrl.replace(/\/+$/, '');
  const realtime = supabase.replace(/^https:/, 'wss:');
  return [
    ...shared,
    `img-src 'self' blob: data: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    `connect-src 'self' ${supabase} ${realtime}`,
    "worker-src 'self' blob:",
    "form-action 'self' https://accounts.google.com https://kite.zerodha.com",
    ...tail,
  ].join('; ');
}
