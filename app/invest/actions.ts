'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { loadLivePortfolio } from '@/lib/invest/live';
import { getAccessToken, GrowwAuthError, GrowwError } from '@/lib/invest/groww';
import { deleteGrowwConnection, saveGrowwConnection } from '@/lib/invest/groww-connection';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { loadManualHoldings } from '@/lib/invest/repository';
import type { LivePortfolioData } from '@/lib/invest/types';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export type HoldingInput = {
  id?: string;
  name: string;
  assetType: string;
  quantity: string;
  valuePerUnit: string;
  currency: string;
  valueAsOf: string;
  marketSource?: string;
  marketSymbol?: string;
};

// Normalizes the optional live-price link. Returns null for "no link", or an error message.
function parseMarketLink(input: HoldingInput): { source: string | null; symbol: string | null } | string {
  const source = typeof input.marketSource === 'string' ? input.marketSource : '';
  const rawSymbol = typeof input.marketSymbol === 'string' ? input.marketSymbol.trim() : '';
  if (!source) return { source: null, symbol: null };
  if (!rawSymbol) return 'Enter the symbol for the live price, or choose “No live price”.';
  if (source === 'alpha_vantage') {
    const symbol = rawSymbol.toUpperCase();
    if (!/^[A-Z0-9&-]{1,20}(\.[A-Z]{2,4})?$/.test(symbol)) return 'Use a stock symbol such as RELIANCE (India) or AAPL (US).';
    // Indian shares are quoted on BSE; other markets use the symbol as entered.
    return { source, symbol: symbol.includes('.') || input.currency.trim().toUpperCase() !== 'INR' ? symbol : `${symbol}.BSE` };
  }
  if (source === 'amfi') {
    const symbol = rawSymbol.toUpperCase();
    return /^IN[A-Z0-9]{10}$/.test(symbol) ? { source, symbol } : 'Use the fund’s 12-character ISIN, such as INF179K01VQ6.';
  }
  if (source === 'coingecko') {
    const symbol = rawSymbol.toLowerCase();
    return /^[a-z0-9-]{1,60}$/.test(symbol) ? { source, symbol } : 'Use the CoinGecko coin id, such as bitcoin or ethereum.';
  }
  return 'Choose a valid live price source.';
}

export async function saveInvestmentHoldingAction(input: HoldingInput) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to save this holding.' };
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' || typeof input.assetType !== 'string' || typeof input.quantity !== 'string' || typeof input.valuePerUnit !== 'string' || typeof input.currency !== 'string' || typeof input.valueAsOf !== 'string' || (input.id !== undefined && (typeof input.id !== 'string' || !validId(input.id)))) return { success: false, message: 'Enter valid holding details.' };

  const name = input.name.trim().slice(0, 100);
  const assetType = input.assetType;
  const quantity = Number(input.quantity);
  const valuePerUnit = Number(input.valuePerUnit);
  const currency = input.currency.trim().toUpperCase();
  const valueAsOf = input.valueAsOf;
  if (!name || !['stock', 'fund', 'etf', 'crypto', 'cash', 'other'].includes(assetType)) return { success: false, message: 'Enter a name and choose an asset type.' };
  if (!/^\d+(?:\.\d{1,6})?$/.test(input.quantity) || !/^\d+(?:\.\d{1,4})?$/.test(input.valuePerUnit) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000 || !Number.isFinite(valuePerUnit) || valuePerUnit < 0 || valuePerUnit > 1_000_000_000_000) return { success: false, message: 'Enter a positive quantity (up to 6 decimals) and a valid unit value (up to 4 decimals).' };
  if (!/^[A-Z]{3}$/.test(currency)) return { success: false, message: 'Use a three-letter currency code, such as INR or USD.' };
  const date = new Date(`${valueAsOf}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueAsOf) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== valueAsOf) return { success: false, message: 'Choose a valid value date.' };

  const link = parseMarketLink(input);
  if (typeof link === 'string') return { success: false, message: link };

  const baseRow = { user_id: auth.userId, name, asset_type: assetType, quantity, value_per_unit: valuePerUnit, currency, value_as_of: valueAsOf, updated_at: new Date().toISOString() };
  const save = (row: Record<string, unknown>) => input.id
    ? auth.supabase.from('investment_holdings').update(row).eq('id', input.id).eq('user_id', auth.userId).select('id').maybeSingle()
    : auth.supabase.from('investment_holdings').insert(row).select('id').maybeSingle();

  let { data, error } = await save({ ...baseRow, market_symbol: link.symbol, market_source: link.source });
  let linkDropped = false;
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    // The api_cache migration adds the market columns; save the rest without them.
    ({ data, error } = await save(baseRow));
    linkDropped = Boolean(link.source);
  }
  if (error || !data) return { success: false, message: input.id ? 'Holding could not be updated. Check that the Investment migration is applied.' : 'Holding could not be saved. Check that the Investment migration is applied.' };
  revalidatePath('/');
  const message = input.id ? 'Holding updated.' : 'Holding added.';
  return { success: true, message: linkDropped ? `${message} Apply the api_cache migration to enable its live price.` : message };
}

export async function deleteInvestmentHoldingAction(id: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to remove this holding.' };
  if (typeof id !== 'string' || !validId(id)) return { success: false, message: 'This holding is invalid.' };
  const { data, error } = await auth.supabase.from('investment_holdings').delete().eq('id', id).eq('user_id', auth.userId).select('id').maybeSingle();
  if (error || !data) return { success: false, message: 'Holding could not be removed.' };
  revalidatePath('/');
  return { success: true, message: 'Holding removed.' };
}

export async function loadInvestLiveAction(): Promise<LivePortfolioData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  const email = typeof data?.claims?.email === 'string' ? data.claims.email.toLowerCase() : null;
  const { holdings } = await loadManualHoldings(supabase, userId);
  return loadLivePortfolio(userId, email, holdings);
}

// Checks the key and secret with Groww before saving them encrypted for this user.
export async function connectGrowwAction(input: { apiKey: string; apiSecret: string }) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to connect Groww.' };
  if (!input || typeof input !== 'object' || typeof input.apiKey !== 'string' || typeof input.apiSecret !== 'string') return { success: false, message: 'Enter your Groww API key and secret.' };

  const apiKey = input.apiKey.replace(/\s+/g, '');
  const apiSecret = input.apiSecret.trim();
  if (apiKey.length < 20 || apiKey.length > 4000 || !/^[A-Za-z0-9._-]+$/.test(apiKey)) return { success: false, message: 'That doesn’t look like a Groww API key. Copy the full key from the Groww API keys page.' };
  if (apiSecret.length < 8 || apiSecret.length > 200 || /\s/.test(apiSecret)) return { success: false, message: 'That doesn’t look like a Groww API secret. Copy it exactly as shown.' };
  if (!credentialEncryptionReady()) return { success: false, message: 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY) first.' };

  try {
    await getAccessToken({ apiKey, apiSecret });
  } catch (error) {
    return { success: false, message: error instanceof GrowwAuthError ? 'Groww didn’t accept this key and secret. Check both, and approve the key on the Groww API keys page if it asks.' : error instanceof GrowwError ? error.message : 'Groww could not be reached. Try again shortly.' };
  }

  try {
    await saveGrowwConnection(auth.userId, { apiKey, apiSecret });
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Your Groww connection could not be saved.' };
  }
  revalidatePath('/');
  return { success: true, message: 'Groww connected. Syncing your holdings…' };
}

export async function disconnectGrowwAction() {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to disconnect Groww.' };
  try {
    await deleteGrowwConnection(auth.userId);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Groww could not be disconnected.' };
  }
  revalidatePath('/');
  return { success: true, message: 'Groww disconnected. Your saved key and secret were deleted from Orbis.' };
}
