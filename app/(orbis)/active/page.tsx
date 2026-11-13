import type { Metadata } from 'next';
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
import { getRole } from '@/lib/security/roles';
import { metaConfigured } from '@/lib/social/meta';
import { listMonth } from '@/lib/social/repository';
import { periodOfDate } from '@/lib/social/month';
import { getPersonSettings } from '@/lib/locale/repository';
import { localDate } from '@/lib/locale/dates';
import { PersonSettingsProvider } from '@/components/locale/person-locale';
import { Onboarding } from '@/components/onboarding/onboarding';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';
import { APP_LOCK_IDLE_MS } from '@/lib/security/app-lock';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { appGate } from '@/lib/auth/app-gate';

export const maxDuration = 60;

// Nothing about this route is public: it isn't linked from the waitlist, it
// isn't in the sitemap, and it is told not to be indexed. Reaching it means
// typing it, and holding a session on the list.
export const metadata: Metadata = { title: { absolute: 'Orbis' }, robots: { index: false, follow: false } };

export default async function Page() {
  // Session, allowlist, lock and PIN (lib/auth/app-gate.tsx); nothing personal loads before it opens.
  const gate = await appGate();
  if (!gate.open) return gate.render;
  const { userId, email } = gate;

  // Read first: the social planner's month starts on this person's calendar, in their own time zone.
  const settings = await getPersonSettings(userId);

  // First run: a good read with no settings row. A failed read counts as
  // onboarded (ONBOARDED_UNKNOWN), so a blip never sends anyone back here.
  if (settings.onboardedAt === null) {
    const [profile, ai] = await Promise.all([getPersonalProfile(userId), getAiPreferences(userId)]);
    return (
      <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
        <PersonSettingsProvider value={settings}>
          <Onboarding initialName={profile.profile?.preferredName ?? ''} initialAi={ai.aiEnabled} aiAvailable={ai.state === 'ready'} externalDocumentIndexing={ai.externalDocumentIndexing} />
        </PersonSettingsProvider>
      </AppLockGuard>
    );
  }

  const socialPeriod = periodOfDate(localDate(new Date(), settings.timeZone));
  const [financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth, socialConnections, role] = await Promise.all([
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
    getRole(userId),
  ]);
  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <PersonSettingsProvider value={settings}>
        <AppShell userId={userId} financeSummary={financeSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} stepsSummary={stepsSummary} homeLocation={homeLocation} integrations={integrations} journal={journal} notificationSettings={notificationSettings} appConnections={appConnections} healthLibrary={healthLibrary} savedWorkbookAdvice={savedWorkbookAdvice} savedPortfolioAdvice={savedPortfolioAdvice} aiPreferences={aiPreferences} routines={routines} socialMonth={{ ...socialMonth, period: socialPeriod }} socialConnections={{ ...socialConnections, configured: { instagram: metaConfigured('instagram'), threads: metaConfigured('threads') } }} socialIsOwner={role === 'owner'} />
      </PersonSettingsProvider>
    </AppLockGuard>
  );
}
