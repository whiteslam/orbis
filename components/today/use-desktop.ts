'use client';

import { useSyncExternalStore } from 'react';
import { DESKTOP_LAYOUT, DESKTOP_QUERY } from '@/lib/shell/desktop';

function subscribe(onChange: () => void) {
  if (!DESKTOP_LAYOUT || typeof window === 'undefined') return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const snapshot = () => DESKTOP_LAYOUT && window.matchMedia(DESKTOP_QUERY).matches;

/**
 * Whether the desktop layout is showing, kept current as the window is resized.
 * False on the server and on the first render, so hydration always matches.
 */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
