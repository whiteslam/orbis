'use client';

import { useEffect } from 'react';

// Registers the service worker once per load, in production only — `next dev`
// serves unhashed chunks that a cached shell would fight with. This is the
// one place registration happens; notification-settings.tsx waits on
// `navigator.serviceWorker.ready` rather than registering its own.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
