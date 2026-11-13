'use client';

import { useSyncExternalStore } from 'react';
import { isNativeApp } from '@/lib/native/orbis-core';
import { getPhoneLink, subscribePhoneLink, type PhoneLink } from '@/lib/native/device-state';

// Inside or outside the app never changes while a page is open.
const never = () => () => {};
const onServer = () => false;

/** True inside the Android app. False on the server and through hydration, so both renders match. */
export function useNativeApp(): boolean {
  return useSyncExternalStore(never, isNativeApp, onServer);
}

/** What the page knows about this phone's link (lib/native/device-state.ts). */
export function usePhoneLink(): PhoneLink {
  return useSyncExternalStore(subscribePhoneLink, getPhoneLink, getPhoneLink);
}
