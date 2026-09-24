import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { InvestmentHolding, InvestmentSummary, MarketSource } from '@/lib/invest/types';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const baseColumns = 'id,name,asset_type,quantity,value_per_unit,currency,value_as_of';

// market_symbol/market_source arrive with the api_cache migration; keep working without them.
export async function loadManualHoldings(supabase: SupabaseClient, userId: string) {
  const detailed = await supabase.from('investment_holdings').select(`${baseColumns},market_symbol,market_source`).eq('user_id', userId).order('updated_at', { ascending: false }).limit(100);
  const result = detailed.error?.code === '42703'
    ? await supabase.from('investment_holdings').select(baseColumns).eq('user_id', userId).order('updated_at', { ascending: false }).limit(100)
    : detailed;
  if (result.error) return { error: result.error, holdings: [] as InvestmentHolding[] };

  const holdings: InvestmentHolding[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name),
    assetType: row.asset_type as InvestmentHolding['assetType'],
    quantity: Number(row.quantity),
    valuePerUnit: Number(row.value_per_unit),
    currency: String(row.currency),
    valueAsOf: String(row.value_as_of),
    marketSymbol: typeof row.market_symbol === 'string' ? row.market_symbol : null,
    marketSource: typeof row.market_source === 'string' ? row.market_source as MarketSource : null,
  }));
  return { error: null, holdings, marketColumns: !detailed.error };
}

export async function getInvestmentSummary(userId: string): Promise<InvestmentSummary> {
  const supabase = await createClient();
  const { error, holdings } = await loadManualHoldings(supabase, userId);
  if (error) {
    const missing = ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '');
    return { databaseReady: !missing, loadError: !missing, holdings: [] };
  }
  return { databaseReady: true, loadError: false, holdings };
}
