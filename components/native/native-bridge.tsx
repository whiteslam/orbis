'use client';

import { useEffect } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativeApp, OrbisCore } from '@/lib/native/orbis-core';
import { setPhoneLink, setSigningOut } from '@/lib/native/device-state';
import { linkThisPhone, pushPlugin } from '@/lib/native/link-phone';
import { safePushPath } from '@/lib/native/push-path';

/**
 * The page's side of the Android app. Renders nothing and does nothing on the web.
 *
 * Mounted by the app shell, which only renders once the person is signed in and
 * Orbis is unlocked (lib/auth/app-gate.tsx; AppLockGuard unmounts it on lock). On
 * mount, and on every return to the app, it links this phone to `userId` and starts
 * push (lib/native/link-phone.ts). A tapped push opens its `url` when that is a path
 * on this site, and nothing else.
 */
export function NativeBridge({ userId }: Readonly<{ userId: string }>) {
  useEffect(() => {
    if (!isNativeApp()) return;
    // A signed-in, unlocked page is mounting, so any earlier sign-out has finished.
    setSigningOut(false);
    let stopped = false;
    let handles: PluginListenerHandle[] = [];

    void (async () => {
      const push = await pushPlugin();
      // Listeners first, so a token or a tap that arrives while linking is not missed.
      const added = await Promise.all([
        push.addListener('registration', ({ value }) => {
          OrbisCore.setPushToken({ token: value })
            .then(() => setPhoneLink({ push: 'registered' }))
            .catch(() => setPhoneLink({ push: 'failed' }));
        }),
        push.addListener('registrationError', () => setPhoneLink({ push: 'failed' })),
        push.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const path = safePushPath((notification.data as { url?: unknown } | undefined)?.url);
          // A full navigation: a hash-only change still reaches the shell's hashchange listener.
          if (path) window.location.assign(path);
        }),
      ]);
      if (stopped) return added.forEach((handle) => void handle.remove());
      handles = added;
      await linkThisPhone(userId);
    })().catch(() => undefined);

    // Back from the background: cheap when nothing changed (one status() call).
    const onReturn = () => {
      if (document.visibilityState === 'visible') linkThisPhone(userId, { resume: true }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onReturn);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onReturn);
      handles.forEach((handle) => void handle.remove());
    };
  }, [userId]);

  return null;
}
