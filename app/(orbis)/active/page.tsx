import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AppShell from '@/components/app-shell';
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
import { getSocialConnections } from '@/lib/social/connections';
import { metaConfigured } from '@/lib/social/meta';
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

// Nothing about this route is public: it isn't linked from the waitlist, it
// isn't in the sitemap, and it is told not to be indexed. Reaching it means
// typing it, and holding a session on the list.
export const metadata: Metadata = { title: { absolute: 'Orbis' }, robots: { index: false, follow: false } };

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  // A stranger gets the sign-in form, not a hint that this is where Orbis lives.
  if (error || !data?.claims) redirect('/login');

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
  if (!unlocked) return <LockScreen pinStatus={pinStatus} />;
  // A device PIN is required before Orbis opens; 'unavailable' (migration not applied) skips it rather than blocking.
  if (pinStatus === 'none' || pinStatus === 'locked') return <PinSetup reset={pinStatus === 'locked'} />;

  // This month in India, where the social planner counts its months.
  const socialPeriod = periodOfDate(indiaToday());
  const [financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth, socialConnections] = await Promise.all([
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
    getSocialConnections(userId),
  ]);
  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <AppShell financeSummary={financeSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} stepsSummary={stepsSummary} homeLocation={homeLocation} integrations={integrations} journal={journal} notificationSettings={notificationSettings} appConnections={appConnections} healthLibrary={healthLibrary} savedWorkbookAdvice={savedWorkbookAdvice} savedPortfolioAdvice={savedPortfolioAdvice} aiPreferences={aiPreferences} routines={routines} socialMonth={{ ...socialMonth, period: socialPeriod }} socialConnections={{ ...socialConnections, configured: { instagram: metaConfigured('instagram'), threads: metaConfigured('threads') } }} />
    </AppLockGuard>
  );
}
