import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { InvestmentSummary } from '@/lib/invest/types';

export async function getInvestmentSummary(userId: string): Promise<InvestmentSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('investment_holdings').select('id,name,asset_type,quantity,value_per_unit,currency,value_as_of').eq('user_id', userId).order('updated_at', { ascending: false }).limit(100);
  if (error) {
    const missing = ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '');
    return { databaseReady: !missing, loadError: !missing, holdings: [] };
  }
  return {
    databaseReady: true,
    loadError: false,
    holdings: (data ?? []).map((holding) => ({
      id: holding.id,
      name: holding.name,
      assetType: holding.asset_type as InvestmentSummary['holdings'][number]['assetType'],
      quantity: Number(holding.quantity),
      valuePerUnit: Number(holding.value_per_unit),
      currency: holding.currency,
      valueAsOf: holding.value_as_of,
    })),
  };
}
