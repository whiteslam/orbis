// The service worker's caching decision, as a pure function so it can be unit
// tested outside a worker context. public/sw.js inlines the same rules in its
// `fetch` handler (service workers can't import modules from an npm build
// without a bundler step) — keep the two in sync; this module is the source
// of truth and sw.js's comment points back here.
export type SwRequest = { mode: string; url: string; method: string };
export type SwStrategy = 'network-first-offline' | 'cache-first' | 'passthrough';

export function strategyFor(request: SwRequest, origin: string): SwStrategy {
  if (request.method !== 'GET') return 'passthrough';
  if (!request.url.startsWith(origin)) return 'passthrough';

  const path = request.url.slice(origin.length);
  if (path.startsWith('/api/')) return 'passthrough';

  if (request.mode === 'navigate') return 'network-first-offline';
  if (path.startsWith('/_next/static/')) return 'cache-first';
  return 'passthrough';
}
