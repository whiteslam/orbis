import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CareerPanel } from '@/components/career/panel/career-panel';
import { PersonSettingsProvider } from '@/components/locale/person-locale';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { appGate } from '@/lib/auth/app-gate';
import { getPersonSettings } from '@/lib/locale/repository';
import { APP_LOCK_IDLE_MS } from '@/lib/security/app-lock';
import { careerPanelOpen } from '@/lib/shell/modules';

// Server actions on this page (search now, tailoring, Send) can run long.
export const maxDuration = 60;

// Like /active: not linked from any public page, and told not to be indexed.
export const metadata: Metadata = { title: { absolute: 'Orbis · Career' }, robots: { index: false, follow: false } };

export default async function Page() {
  // The same door as /active (lib/auth/app-gate.tsx): session, allowlist, lock, PIN.
  const gate = await appGate();
  if (!gate.open) return gate.render;
  // The panel's dates (today's agenda, the week's pace, follow-ups) are the person's own, as on /active.
  const settings = await getPersonSettings(gate.userId);
  // Career switched off, or first run not finished: /active is where they belong (it shows onboarding first).
  if (!careerPanelOpen(settings)) redirect('/active');

  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <PersonSettingsProvider value={settings}>
        <CareerPanel email={gate.email} />
      </PersonSettingsProvider>
    </AppLockGuard>
  );
}
