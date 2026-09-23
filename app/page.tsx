import { redirect } from 'next/navigation';
import OrbisApp from '@/components/orbis-app';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getGoalsSummary } from '@/lib/goals/repository';
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
  return <OrbisApp financeSummary={financeSummary} goalsSummary={goalsSummary} />;
}
