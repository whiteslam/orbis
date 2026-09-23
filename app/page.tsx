import { redirect } from 'next/navigation';
import OrbisApp from '@/components/orbis-app';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getGoalsSummary } from '@/lib/goals/repository';
import { getContextNotes } from '@/lib/goals/memory';
import { getInvestmentSummary } from '@/lib/invest/repository';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect('/login');

  const userId = data.claims.sub;
  if (typeof userId !== 'string') redirect('/login');

  const financeSummary = await getFinanceSummary(userId);
  const goalsSummary = await getGoalsSummary(userId);
  const contextNotes = await getContextNotes(userId);
  const investmentSummary = await getInvestmentSummary(userId);
  return <OrbisApp financeSummary={financeSummary} goalsSummary={goalsSummary} contextNotes={contextNotes} investmentSummary={investmentSummary} />;
}
