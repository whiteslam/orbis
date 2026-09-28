// Push subscriptions may only point at the real browser push services. The same
// list is enforced in the database (push_subscriptions_endpoint_host in
// 202609280200_hardening.sql); keep the two in step.

const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
// Apple uses one label before push.apple.com; Windows (WNS) uses regional subdomains.
const APPLE_HOST = /^[a-z0-9-]+\.push\.apple\.com$/;
const WINDOWS_HOST = /^[a-z0-9.-]+\.notify\.windows\.com$/;

export function isAllowedPushEndpoint(url: string): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  if (!EXACT_HOSTS.has(host) && !APPLE_HOST.test(host) && !WINDOWS_HOST.test(host)) return false;
  // The raw string must start with exactly this origin: no port, no user info and
  // no case tricks, which is also what the database CHECK requires.
  return url.startsWith(`https://${host}/`);
}
