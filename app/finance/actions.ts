'use server';

import { revalidatePath } from 'next/cache';
import { disconnectGmail } from '@/lib/gmail/connection';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MANUAL_NOTE_MAX_LENGTH, PAYMENT_METHODS } from '@/lib/finance/manual';

export type FinanceActionState = {
  success: boolean;
  message: string;
  revocationFailed?: boolean;
};

export async function disconnectGmailAction(): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before disconnecting Gmail.' };

  try {
    const result = await disconnectGmail(userId);
    revalidatePath('/active');
    return {
      success: true,
      revocationFailed: !result.revoked,
      message: result.revoked
        ? 'Gmail has been disconnected.'
        : 'Gmail was removed from Orbis. Google could not confirm token revocation, so you can also remove Orbis in your Google account security settings.',
    };
  } catch {
    revalidatePath('/active');
    return { success: false, message: 'Gmail could not be disconnected. Please try again.' };
  }
}

export type ManualTransactionInput = {
  amount: string;
  currency: string;
  direction: string;
  category: string;
  merchant: string;
  paymentMethod: string;
  occurredAt: string;
  note: string;
};

export async function addManualTransactionAction(input: ManualTransactionInput): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before adding a transaction.' };

  const fields = ['amount', 'currency', 'direction', 'category', 'merchant', 'paymentMethod', 'occurredAt', 'note'] as const;
  if (!input || typeof input !== 'object' || fields.some((field) => typeof input[field] !== 'string')) {
    return { success: false, message: 'This transaction is invalid. Refresh Finance and try again.' };
  }
  const amount = Number(input.amount);
  const currency = input.currency.trim().toUpperCase();
  const direction = input.direction;
  const category = input.category;
  const merchant = input.merchant.trim().slice(0, 100);
  const paymentMethod = input.paymentMethod;
  const note = input.note.trim();
  const occurredAt = new Date(input.occurredAt);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || Math.round(amount * 100) !== amount * 100) {
    return { success: false, message: 'Enter a valid amount with no more than two decimal places.' };
  }
  if (!/^[A-Z]{3}$/.test(currency)) return { success: false, message: 'Use a three-letter currency code, such as INR.' };
  if (direction !== 'expense' && direction !== 'income') return { success: false, message: 'Choose whether this was an expense or income.' };
  const categories: readonly string[] = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (!categories.includes(category)) return { success: false, message: 'Choose a category.' };
  if (paymentMethod && !PAYMENT_METHODS.some(([key]) => key === paymentMethod)) return { success: false, message: 'Choose a valid payment method.' };
  if (note.length > MANUAL_NOTE_MAX_LENGTH) return { success: false, message: `Keep the note under ${MANUAL_NOTE_MAX_LENGTH} characters.` };
  if (Number.isNaN(occurredAt.getTime())) return { success: false, message: 'The transaction date is invalid.' };
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) return { success: false, message: 'The transaction date cannot be in the future.' };
  if (occurredAt.getFullYear() < 2000) return { success: false, message: 'The transaction date is too far in the past.' };

  try {
    const supabase = await createClient();
    const base = {
      user_id: userId,
      amount,
      currency,
      direction,
      merchant: merchant || null,
      category,
      occurred_at: occurredAt.toISOString(),
      source: 'manual',
      source_message_id: null,
    };
    const { error } = await supabase.from('transactions').insert({ ...base, payment_method: paymentMethod || null, note: note || null });

    if (error?.code === 'PGRST204' || error?.code === '42703') {
      // The manual-transactions migration is not applied yet; keep the core record.
      const { error: fallbackError } = await supabase.from('transactions').insert(base);
      if (fallbackError) {
        console.error('Saving a manual transaction failed', fallbackError);
        return { success: false, message: 'The transaction could not be saved. Try again in a moment.' };
      }
      console.error('transactions has no payment_method/note columns; saved without them', error);
      revalidatePath('/active');
      return {
        success: true,
        message: paymentMethod || note
          ? 'Transaction saved, but the payment method and note couldn’t be kept this time.'
          : 'Transaction saved.',
      };
    }
    if (error) return { success: false, message: 'The transaction could not be saved. Please try again.' };

    revalidatePath('/active');
    return { success: true, message: direction === 'expense' ? 'Expense saved.' : 'Income saved.' };
  } catch {
    return { success: false, message: 'The transaction could not be saved. Please refresh Finance and try again.' };
  }
}

export async function deleteManualTransactionAction(transactionId: string): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before deleting a transaction.' };
  if (!isUuid(transactionId)) return { success: false, message: 'This transaction is invalid.' };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
      .eq('user_id', userId)
      .eq('source', 'manual')
      .select('id')
      .maybeSingle();
    if (error || !data) return { success: false, message: 'This transaction could not be deleted. Refresh Finance and try again.' };

    revalidatePath('/active');
    return { success: true, message: 'Transaction deleted.' };
  } catch {
    return { success: false, message: 'This transaction could not be deleted. Please try again.' };
  }
}

/**
 * Sets or clears what you expect to earn.
 *
 * One entry per stream, so a salary plus a retainer is two. Clearing is
 * deleting: an income plan is a statement about now, not a history.
 */
export async function saveIncomePlanAction(input: { id?: string; label: string; amount: string; currency: string; payDay: number; category: string }) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again to save this.' };
  if (!input || typeof input !== 'object') return { success: false, message: 'Enter the details.' };
  const supabase = await createClient();

  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 60) : '';
  if (!label) return { success: false, message: 'Give it a name, like Salary.' };
  if (typeof input.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(input.amount)) return { success: false, message: 'Enter the amount you expect.' };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return { success: false, message: 'Enter a realistic amount.' };
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : 'INR';
  if (!/^[A-Z]{3}$/.test(currency)) return { success: false, message: 'Use a three-letter currency code.' };
  const payDay = Number(input.payDay);
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) return { success: false, message: 'Choose the day it usually arrives.' };
  const category = typeof input.category === 'string' && (INCOME_CATEGORIES as readonly string[]).includes(input.category) ? input.category : 'Salary';

  const row = { user_id: userId, label, amount, currency, pay_day: payDay, category };
  const { error } = input.id
    ? await supabase.from('income_plan').update(row).eq('id', input.id).eq('user_id', userId)
    : await supabase.from('income_plan').insert(row);
  if (error) {
    return { success: false, message: isMissingTable(error) ? 'Apply the income plan migration in Supabase, then try again.' : 'That could not be saved. Try again.' };
  }
  revalidatePath('/active');
  return { success: true, message: input.id ? 'Updated.' : `${label} saved.` };
}

export async function deleteIncomePlanAction(id: string) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again to remove this.' };
  if (!isUuid(id)) return { success: false, message: 'That entry is invalid.' };
  const supabase = await createClient();
  const { error } = await supabase.from('income_plan').delete().eq('id', id).eq('user_id', userId);
  if (error) return { success: false, message: 'That could not be removed.' };
  revalidatePath('/active');
  return { success: true, message: 'Removed. What you already recorded is kept.' };
}
