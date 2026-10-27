import type { Metadata } from 'next';
import { CareerPanel } from '@/components/career/panel/career-panel';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { appGate } from '@/lib/auth/app-gate';
import { APP_LOCK_IDLE_MS } from '@/lib/security/app-lock';

// Server actions on this page (search now, tailoring, Send) can run long.
export const maxDuration = 60;

// Like /active: not linked from any public page, and told not to be indexed.
export const metadata: Metadata = { title: { absolute: 'Orbis · Career' }, robots: { index: false, follow: false } };

export default async function Page() {
  // The same door as /active (lib/auth/app-gate.tsx): session, allowlist, lock, PIN.
  const gate = await appGate();
  if (!gate.open) return gate.render;

  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <CareerPanel email={gate.email} />
    </AppLockGuard>
  );
}
