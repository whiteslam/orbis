import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PersonSettingsProvider } from '@/components/locale/person-locale';
import { ResearchPanel } from '@/components/research/panel/research-panel';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { appGate } from '@/lib/auth/app-gate';
import { getPersonSettings } from '@/lib/locale/repository';
import { researchDeskAvailable } from '@/lib/research/access';
import { dispatchConfig } from '@/lib/research/dispatch';
import { APP_LOCK_IDLE_MS } from '@/lib/security/app-lock';
import { getRole } from '@/lib/security/roles';

// Like /active: not linked from any public page, and told not to be indexed.
export const metadata: Metadata = { title: { absolute: 'Orbis · Research desk' }, robots: { index: false, follow: false } };

export default async function Page() {
  // The same door as /active (lib/auth/app-gate.tsx): session, allowlist, lock, PIN.
  const gate = await appGate();
  if (!gate.open) return gate.render;
  // Then the desk's own: owner role only, and only once its worker is set up.
  if (!researchDeskAvailable(await getRole(gate.userId), gate.email, dispatchConfig() !== null)) notFound();
  // Nothing on the desk reads it yet, but every signed-in page hands it down, so a shared component never falls back to India time here.
  const settings = await getPersonSettings(gate.userId);

  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <PersonSettingsProvider value={settings}>
        <ResearchPanel />
      </PersonSettingsProvider>
    </AppLockGuard>
  );
}
