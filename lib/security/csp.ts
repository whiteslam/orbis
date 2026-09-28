// The Content-Security-Policy, built per request so scripts can carry a nonce.
//
// style-src keeps 'unsafe-inline' because React style={…} attributes are inline
// styles and the UI uses them for bars and rings; scripts are the attack surface
// CSP exists for, and those are nonce-only with 'strict-dynamic'.
export function buildCsp({ nonce, supabaseUrl, isDev }: { nonce: string; supabaseUrl: string; isDev: boolean }) {
  const supabase = supabaseUrl.replace(/\/+$/, '');
  const realtime = supabase.replace(/^https:/, 'wss:');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${realtime}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://kite.zerodha.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
