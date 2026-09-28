import { redirect } from 'next/navigation';
import OrbisApp from '@/components/orbis-app';
import { Landing } from '@/components/marketing/landing';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getContextNotes } from '@/lib/memory/notes';
import { getFitnessPersona, getHomeLocation, getPersonalProfile } from '@/lib/personal/repository';
import { getAppConnections, getIntegrationStatus } from '@/lib/providers/status';
import { getJournal } from '@/lib/journal/repository';
import { getHealthLibrary } from '@/lib/health-docs/repository';
import { getNotificationSettings } from '@/lib/notifications/repository';
import { getStepsSummary } from '@/lib/health/steps-repository';
import { getLatestAiResult } from '@/lib/ai/results';
import { getAiPreferences } from '@/lib/ai/preferences';
import { getRoutinesSummary } from '@/lib/routines/repository';
import { listMonth } from '@/lib/social/repository';
import { indiaToday, periodOfDate } from '@/lib/social/month';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';
import { createClient } from '@/lib/supabase/server';
import { APP_LOCK_IDLE_MS, isAppUnlocked } from '@/lib/security/app-lock';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { LockScreen } from '@/components/security/lock-screen';
import { PinSetup } from '@/components/security/pin-setup';
import { getPinStatus } from '@/lib/security/pin-store';
import { accessAllowed } from '@/lib/security/access';

export const maxDuration = 60;

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return <Landing />;

  const userId = data.claims.sub;
  if (typeof userId !== 'string') redirect('/login');

  const email = typeof data.claims.email === 'string' ? data.claims.email.toLowerCase() : null;

  // Closing the door does not evict whoever is already inside, and a Supabase
  // session outlives a sign-in. Checked on every load of the app, so removing
  // an address from the list takes effect on their next request rather than
  // whenever their token happens to expire.
  if (!accessAllowed(email)) {
    await supabase.auth.signOut();
    redirect('/login?error=private');
  }

  // While locked, load nothing personal: only the lock screen is rendered.
  // The two checks are independent, so neither waits for the other.
  const [pinStatus, unlocked] = await Promise.all([getPinStatus(userId), isAppUnlocked(data.claims)]);
  if (!unlocked) return <LockScreen email={email} pinStatus={pinStatus} />;
  // A device PIN is required before Orbis opens; 'unavailable' (migration not applied) skips it rather than blocking.
  if (pinStatus === 'none' || pinStatus === 'locked') return <PinSetup reset={pinStatus === 'locked'} />;

  // This month in India, where the social planner counts its months.
  const socialPeriod = periodOfDate(indiaToday());
  const [financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth] = await Promise.all([
    getFinanceSummary(userId),
    getContextNotes(userId),
    getFitnessPersona(userId),
    getPersonalProfile(userId),
    getStepsSummary(userId),
    getHomeLocation(userId),
    getIntegrationStatus(userId, email),
    getJournal(userId),
    getNotificationSettings(userId),
    getAppConnections(userId, email),
    getHealthLibrary(userId),
    // Saved AI results, so advice generated earlier is shown again instead of regenerated.
    getLatestAiResult(userId, 'workbook_advice') as Promise<SavedWorkbookAdvice | null>,
    getLatestAiResult(userId, 'portfolio_advice') as Promise<SavedPortfolioAdvice | null>,
    getAiPreferences(userId),
    getRoutinesSummary(userId),
    listMonth(userId, socialPeriod),
  ]);
  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <OrbisApp financeSummary={financeSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} stepsSummary={stepsSummary} homeLocation={homeLocation} integrations={integrations} journal={journal} notificationSettings={notificationSettings} appConnections={appConnections} healthLibrary={healthLibrary} savedWorkbookAdvice={savedWorkbookAdvice} savedPortfolioAdvice={savedPortfolioAdvice} aiPreferences={aiPreferences} routines={routines} socialMonth={{ ...socialMonth, period: socialPeriod }} />
    </AppLockGuard>
  );
}
