// pnpm check:connections
//
// Checks the environment every connect flow depends on, the way Next.js loads
// it, and prints the exact callback URL each provider has to have registered.
// Most "it just says could not be connected" failures are one of these: a
// missing key, a redirect URI on a different host from the site, or Meta being
// asked to return to plain http. Secret values are never printed.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// @next/env is Next's own dependency, not ours, so it is found through next.
const require = createRequire(import.meta.url);
const nextEnv = require(require.resolve('@next/env', { paths: [require.resolve('next')] }));

const mode = process.argv.includes('--production') ? 'production' : 'development';
nextEnv.loadEnvConfig(process.cwd(), mode === 'development');

let failures = 0;
const line = (mark, text) => console.log(`  ${mark} ${text}`);
const ok = (text) => line('✓', text);
const warn = (text) => line('!', text);
const fail = (text) => { failures += 1; line('✗', text); };
const env = (name) => process.env[name]?.trim() || '';
const has = (...names) => names.every((name) => env(name));
const missing = (...names) => names.filter((name) => !env(name)).join(', ');
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

console.log(`Connection setup (${mode})\n`);

// Duplicate keys: the last one silently wins, which is easy to forget.
console.log('.env.local');
if (existsSync('.env.local')) {
  const seen = new Map();
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = raw.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match) seen.set(match[1], [...(seen.get(match[1]) ?? []), match[2].trim()]);
  }
  const duplicates = [...seen].filter(([, values]) => values.length > 1);
  if (!duplicates.length) ok('no duplicate keys');
  for (const [name, values] of duplicates) {
    (new Set(values).size > 1 ? warn : ok)(`${name} is set ${values.length} times${new Set(values).size > 1 ? ' with different values; the last one is used' : ' (same value)'}`);
  }
} else {
  warn('no .env.local here; run this from the app folder');
}

console.log('\nSite');
let site = null;
try {
  site = new URL(env('NEXT_PUBLIC_SITE_URL'));
  if (site.protocol === 'http:' && !LOCAL.has(site.hostname)) site.protocol = 'https:';
  ok(`NEXT_PUBLIC_SITE_URL → ${site.origin}`);
  if (mode === 'production' && LOCAL.has(site.hostname)) fail('the live site URL points at localhost, so every callback returns to the wrong place');
} catch {
  (mode === 'production' ? fail : warn)('NEXT_PUBLIC_SITE_URL is missing or not a URL');
}
if (env('APP_LOCK_SECRET').length >= 32 || env('SUPABASE_SECRET_KEY')) ok('OAuth state can be signed');
else fail('set APP_LOCK_SECRET (32+ characters) or SUPABASE_SECRET_KEY, or Gmail and Zerodha cannot start');

console.log('\nGmail / Google');
if (!has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GMAIL_TOKEN_ENCRYPTION_KEY')) {
  fail(`missing ${missing('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GMAIL_TOKEN_ENCRYPTION_KEY')}`);
} else {
  let redirect = null;
  try { redirect = new URL(env('GOOGLE_REDIRECT_URI')); } catch { fail('GOOGLE_REDIRECT_URI is not a URL'); }
  if (redirect) {
    if (redirect.pathname !== '/auth/gmail/callback') fail('GOOGLE_REDIRECT_URI must end in /auth/gmail/callback');
    else if (redirect.protocol !== 'https:' && !LOCAL.has(redirect.hostname)) fail('GOOGLE_REDIRECT_URI must be https unless it is localhost');
    else ok(`register this redirect URI in Google Cloud → Credentials: ${redirect.href}`);
    if (site && redirect.host !== site.host) warn(`redirect host ${redirect.host} differs from the site host ${site.host}; connections started on the site are sent to ${redirect.host} first`);
  }
  const key = Buffer.from(env('GMAIL_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length === 32) ok('GMAIL_TOKEN_ENCRYPTION_KEY is a 32-byte key');
  else fail('GMAIL_TOKEN_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)');
  warn('if the Google Cloud consent screen is still in "Testing", Google expires the connection every 7 days; publish it to stop that');
}

console.log('\nZerodha');
if (!has('ZERODHA_API_KEY', 'ZERODHA_API_SECRET')) fail(`missing ${missing('ZERODHA_API_KEY', 'ZERODHA_API_SECRET')}`);
else {
  ok(`the Kite app's redirect URL must be exactly ${site ? site.origin : '<site>'}/auth/zerodha/callback`);
  warn('Kite sessions end every morning at 6:00 IST by design; reconnecting daily is expected, not a failure');
}

console.log('\nGroww');
if (!has('GROWW_API_KEY', 'GROWW_API_SECRET')) warn(`missing ${missing('GROWW_API_KEY', 'GROWW_API_SECRET')} (only needed for the server-wide Groww login)`);
else {
  ok('key and secret set');
  warn('Groww API access must be approved once a day on the Groww API keys page');
}

for (const [name, id, secret, slug] of [['Instagram', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'instagram'], ['Threads', 'THREADS_APP_ID', 'THREADS_APP_SECRET', 'threads']]) {
  console.log(`\n${name}`);
  if (!has(id, secret)) { fail(`missing ${missing(id, secret)}`); continue; }
  if (!site) continue;
  if (site.protocol !== 'https:') warn(`Meta only returns to https; connect ${name} from the live site or through an https tunnel`);
  ok(`register this redirect URI in the Meta app: ${site.origin}/auth/social/${slug}/callback`);
  if (slug === 'instagram') warn('use the Instagram app ID and secret from Instagram API → API setup with Instagram login, not the Meta app ID; the account must be Business or Creator');
  if (env('META_APP_ID') && slug === 'instagram') warn('META_APP_ID is no longer read; Instagram now uses INSTAGRAM_APP_ID');
  warn('until Meta App Review approves the permissions, only accounts added as testers on the app can connect');
}

console.log(failures ? `\n${failures} problem${failures === 1 ? '' : 's'} to fix.` : '\nNothing blocking.');
process.exitCode = failures ? 1 : 0;
