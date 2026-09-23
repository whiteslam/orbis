'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return error || typeof userId !== 'string' ? null : { supabase, userId };
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
};

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

  const row = { user_id: auth.userId, name, asset_type: assetType, quantity, value_per_unit: valuePerUnit, currency, value_as_of: valueAsOf, updated_at: new Date().toISOString() };
  if (input.id) {
    const { data, error } = await auth.supabase.from('investment_holdings').update(row).eq('id', input.id).eq('user_id', auth.userId).select('id').maybeSingle();
    if (error || !data) return { success: false, message: 'Holding could not be updated. Check that the Investment migration is applied.' };
  } else {
    const { error } = await auth.supabase.from('investment_holdings').insert(row);
    if (error) return { success: false, message: 'Holding could not be saved. Check that the Investment migration is applied.' };
  }
  revalidatePath('/');
  return { success: true, message: input.id ? 'Holding updated.' : 'Holding added.' };
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
