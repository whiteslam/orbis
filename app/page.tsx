import { redirect } from 'next/navigation';
import OrbisApp from '@/components/orbis-app';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getGoalsSummary } from '@/lib/goals/repository';
import { getContextNotes } from '@/lib/goals/memory';
import { getFitnessPersona, getHomeLocation, getPersonalProfile } from '@/lib/personal/repository';
import { getAppConnections, getIntegrationStatus } from '@/lib/providers/status';
import { getJournal } from '@/lib/journal/repository';
import { getHealthLibrary } from '@/lib/health-docs/repository';
import { getNotificationSettings } from '@/lib/notifications/repository';
import { getInvestmentSummary } from '@/lib/invest/repository';
import { getStepsSummary } from '@/lib/health/steps-repository';
import { createClient } from '@/lib/supabase/server';
import { APP_LOCK_IDLE_MS, isAppUnlocked } from '@/lib/security/app-lock';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { LockScreen } from '@/components/security/lock-screen';
import { PinSetup } from '@/components/security/pin-setup';
import { getPinStatus } from '@/lib/security/pin-store';

export const maxDuration = 60;

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect('/login');

  const userId = data.claims.sub;
  if (typeof userId !== 'string') redirect('/login');

  const email = typeof data.claims.email === 'string' ? data.claims.email.toLowerCase() : null;

  // While locked, load nothing personal: only the lock screen is rendered.
  const pinStatus = await getPinStatus(userId);
  if (!(await isAppUnlocked(data.claims))) return <LockScreen email={email} pinStatus={pinStatus} />;
  // A device PIN is required before Orbis opens; 'unavailable' (migration not applied) skips it rather than blocking.
  if (pinStatus === 'none' || pinStatus === 'locked') return <PinSetup reset={pinStatus === 'locked'} />;

  const [financeSummary, goalsSummary, contextNotes, fitnessPersona, personalProfile, investmentSummary, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary] = await Promise.all([
    getFinanceSummary(userId),
    getGoalsSummary(userId),
    getContextNotes(userId),
    getFitnessPersona(userId),
    getPersonalProfile(userId),
    getInvestmentSummary(userId),
    getStepsSummary(userId),
    getHomeLocation(userId),
    getIntegrationStatus(userId, email),
    getJournal(userId),
    getNotificationSettings(userId),
    getAppConnections(userId, email),
    getHealthLibrary(userId),
  ]);
  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <OrbisApp financeSummary={financeSummary} goalsSummary={goalsSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} investmentSummary={investmentSummary} stepsSummary={stepsSummary} homeLocation={homeLocation} integrations={integrations} journal={journal} notificationSettings={notificationSettings} appConnections={appConnections} healthLibrary={healthLibrary} />
    </AppLockGuard>
  );
}
