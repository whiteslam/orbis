'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { lockAppAction, touchAppLockAction } from '@/app/security/actions';

const HEARTBEAT_MS = 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

// Hides the app after idleMs without activity, or when it returns from the background after that long.
// The server enforces the same window through the unlock cookie; this keeps the screen in step with it.
export function AppLockGuard({ idleMs, children }: { idleMs: number; children: ReactNode }) {
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  // Seeds the idle clock once on mount; re-running this on every render would defeat the timers below.
  // eslint-disable-next-line react-hooks/purity
  const lastActivity = useRef(Date.now());
  // eslint-disable-next-line react-hooks/purity
  const lastHeartbeat = useRef(Date.now());
  const lockedRef = useRef(false);

  const lock = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    void lockAppAction().catch(() => undefined).finally(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const expired = () => Date.now() - lastActivity.current >= idleMs;

    const onActivity = () => {
      if (lockedRef.current) return;
      if (expired()) return lock();
      lastActivity.current = Date.now();
      if (Date.now() - lastHeartbeat.current < HEARTBEAT_MS) return;
      lastHeartbeat.current = Date.now();
      void touchAppLockAction().then(({ unlocked }) => { if (!unlocked) lock(); }).catch(() => undefined);
    };

    const onReturn = () => {
      if (document.visibilityState === 'visible' && expired()) lock();
    };

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    const timer = window.setInterval(() => { if (expired()) lock(); }, 15_000);

    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
      window.clearInterval(timer);
    };
  }, [idleMs, lock]);

  return locked ? (
    <main className="auth-stage lock-cover" aria-live="polite">
      <div className="lock-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
      <p>Locking Orbis…</p>
    </main>
  ) : children;
}
