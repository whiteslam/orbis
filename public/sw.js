// Orbis service worker: shows daily notifications and opens Orbis when
// tapped, and caches the app shell so a lost connection lands on the offline
// page instead of the browser's own dinosaur.
const CACHE = 'orbis-v1';
const PRECACHE_URLS = ['/offline', '/icon.png', '/apple-icon.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Same rules as lib/pwa/sw-routing.ts's strategyFor, inlined here because a
// service worker can't import from the app's build without a bundler step.
// Keep the two in sync.
function strategyFor(request, origin) {
  if (request.method !== 'GET') return 'passthrough';
  if (!request.url.startsWith(origin)) return 'passthrough';
  const path = request.url.slice(origin.length);
  if (path.startsWith('/api/')) return 'passthrough';
  if (request.mode === 'navigate') return 'network-first-offline';
  if (path.startsWith('/_next/static/')) return 'cache-first';
  return 'passthrough';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor(request, self.location.origin);

  if (strategy === 'network-first-offline') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('/offline')) ?? Response.error();
      }
    })());
    return;
  }

  if (strategy === 'cache-first') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // passthrough: /api/*, auth, Supabase, any cross-origin request and non-GETs
  // are never intercepted.
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Orbis';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'orbis',
    data: { url: typeof payload.url === 'string' ? payload.url : '/?notifications=open' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      return existing.navigate(target);
    }
    return self.clients.openWindow(target);
  })());
});
