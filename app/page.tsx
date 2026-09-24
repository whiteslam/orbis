import { redirect } from 'next/navigation';
import OrbisApp from '@/components/orbis-app';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getGoalsSummary } from '@/lib/goals/repository';
import { getContextNotes } from '@/lib/goals/memory';
import { getFitnessPersona, getHomeLocation, getPersonalProfile } from '@/lib/personal/repository';
import { getIntegrationStatus } from '@/lib/providers/status';
import { getInvestmentSummary } from '@/lib/invest/repository';
import { getStepsSummary } from '@/lib/health/steps-repository';
import { createClient } from '@/lib/supabase/server';
import { APP_LOCK_IDLE_MS, isAppUnlocked } from '@/lib/security/app-lock';
import { AppLockGuard } from '@/components/security/app-lock-guard';
import { LockScreen } from '@/components/security/lock-screen';

export const maxDuration = 60;

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect('/login');

  const userId = data.claims.sub;
  if (typeof userId !== 'string') redirect('/login');

  const email = typeof data.claims.email === 'string' ? data.claims.email.toLowerCase() : null;

  // While locked, load nothing personal: only the lock screen is rendered.
  if (!(await isAppUnlocked(data.claims))) return <LockScreen email={email} />;

  const [financeSummary, goalsSummary, contextNotes, fitnessPersona, personalProfile, investmentSummary, stepsSummary, homeLocation, integrations] = await Promise.all([
    getFinanceSummary(userId),
    getGoalsSummary(userId),
    getContextNotes(userId),
    getFitnessPersona(userId),
    getPersonalProfile(userId),
    getInvestmentSummary(userId),
    getStepsSummary(userId),
    getHomeLocation(userId),
    getIntegrationStatus(userId, email),
  ]);
  return (
    <AppLockGuard idleMs={APP_LOCK_IDLE_MS}>
      <OrbisApp financeSummary={financeSummary} goalsSummary={goalsSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} investmentSummary={investmentSummary} stepsSummary={stepsSummary} homeLocation={homeLocation} integrations={integrations} />
    </AppLockGuard>
  );
}
