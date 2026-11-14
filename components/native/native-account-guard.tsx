'use client';

import { useEffect } from 'react';
import { isNativeApp, OrbisCore } from '@/lib/native/orbis-core';
import { resetPhoneLink, wipeAtSignIn } from '@/lib/native/device-state';

/**
 * Wipes the phone as soon as a different person signs in, even while Orbis is still
 * locked. Renders nothing and does nothing on the web.
 *
 * NativeBridge does the same reset (lib/native/link-phone.ts) but only mounts once
 * Orbis is unlocked, so another account's data could sit on the phone behind the lock
 * or PIN screen. lib/auth/app-gate.tsx renders this beside those two screens.
 */
export function NativeAccountGuard({ userId }: Readonly<{ userId: string }>) {
  useEffect(() => {
    if (!isNativeApp()) return;
    void (async () => {
      const status = await OrbisCore.status();
      if (!wipeAtSignIn(status, userId)) return;
      // Same order as the reset in linkThisPhone: forget the old push state, then wipe and revoke.
      resetPhoneLink();
      await OrbisCore.signOut({ revoke: true });
    })().catch((error: unknown) => console.error('Phone account check failed', error));
  }, [userId]);

  return null;
}
