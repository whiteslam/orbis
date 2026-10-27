import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResearchPanel } from '@/components/research/panel/research-panel';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { appGate } from '@/lib/auth/app-gate';
import { researchDeskAvailable } from '@/lib/research/access';
import { dispatchConfig } from '@/lib/research/dispatch';
import { APP_LOCK_IDLE_MS } from '@/lib/security/app-lock';

// Like /active: not linked from any public page, and told not to be indexed.
export const metadata: Metadata = { title: { absolute: 'Orbis · Research desk' }, robots: { index: false, follow: false } };

export default async function Page() {
  // The same door as /active (lib/auth/app-gate.tsx): session, allowlist, lock, PIN.
  const gate = await appGate();
  if (!gate.open) return gate.render;
  // Then the desk's own: owner only, and only once its worker is set up.
  if (!researchDeskAvailable(gate.email, dispatchConfig() !== null)) notFound();

  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <ResearchPanel />
    </AppLockGuard>
  );
}
