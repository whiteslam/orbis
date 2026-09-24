'use server';

import { revalidatePath } from 'next/cache';
import { disconnectGmail, parsePendingFinanceCandidates, syncGmail } from '@/lib/finance/sync';
import { getAuthenticatedUserId, GoogleOAuthError } from '@/lib/gmail/oauth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MANUAL_NOTE_MAX_LENGTH, PAYMENT_METHODS } from '@/lib/finance/manual';

export type FinanceActionState = {
  success: boolean;
  message: string;
  candidatesAdded?: number;
  revocationFailed?: boolean;
};

export async function syncFinanceAction(): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before syncing Gmail.' };

  try {
    const result = await syncGmail(userId);
    revalidatePath('/');
    return {
      success: true,
      candidatesAdded: result.candidatesAdded,
      message: !result.syncComplete
        ? `Sync is continuing. ${result.candidatesAdded} new candidate${result.candidatesAdded === 1 ? '' : 's'} found in this batch. Tap Sync now to continue.`
        : result.candidatesAdded === 0
          ? 'Sync complete. No new transaction alert emails were found.'
          : `Sync complete. Found ${result.candidatesAdded} new transaction alert${result.candidatesAdded === 1 ? '' : 's'} to review later.`,
    };
  } catch (error) {
    const message = error instanceof GoogleOAuthError ? error.message : 'Gmail could not be synced. Please try again.';
    revalidatePath('/');
    return { success: false, message };
  }
}

export async function disconnectGmailAction(): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before disconnecting Gmail.' };

  try {
    const result = await disconnectGmail(userId);
    revalidatePath('/');
    return {
      success: true,
      revocationFailed: !result.revoked,
      message: result.revoked
        ? 'Gmail has been disconnected.'
        : 'Gmail was removed from Orbis. Google could not confirm token revocation, so you can also remove Orbis in your Google account security settings.',
    };
  } catch {
    revalidatePath('/');
    return { success: false, message: 'Gmail could not be disconnected. Please try again.' };
  }
}

export async function parseFinanceCandidatesAction(): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before reading Gmail alerts.' };

  try {
    const result = await parsePendingFinanceCandidates(userId);
    revalidatePath('/');
    return {
      success: true,
      message: result.processedCount === 0
        ? 'No unparsed Gmail alerts are waiting.'
        : `${result.parsedCount} alert${result.parsedCount === 1 ? '' : 's'} ready to review; ${result.unrecognizedCount} need details entered manually or can be ignored.`,
    };
  } catch (error) {
    revalidatePath('/');
    return {
      success: false,
      message: error instanceof GoogleOAuthError ? error.message : 'Gmail alerts could not be read. Apply the transaction review migration and try again.',
    };
  }
}

export type CandidateConfirmation = {
  candidateId: string;
  amount: string;
  currency: string;
  direction: string;
  merchant: string;
  occurredAt: string;
};

export async function confirmFinanceCandidateAction(input: CandidateConfirmation): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before saving a transaction.' };

  if (!input || typeof input !== 'object' || typeof input.candidateId !== 'string' || typeof input.amount !== 'string' || typeof input.currency !== 'string' || typeof input.direction !== 'string' || typeof input.merchant !== 'string' || typeof input.occurredAt !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.candidateId)) {
    return { success: false, message: 'This alert is invalid. Refresh Finance and try again.' };
  }
  const amount = Number(input.amount);
  const currency = input.currency.trim().toUpperCase();
  const direction = input.direction;
  const merchant = input.merchant.trim().slice(0, 100);
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || Math.round(amount * 100) !== amount * 100) {
    return { success: false, message: 'Enter a valid amount with no more than two decimal places.' };
  }
  if (!/^[A-Z]{3}$/.test(currency)) return { success: false, message: 'Use a three-letter currency code, such as INR.' };
  if (direction !== 'expense' && direction !== 'income') return { success: false, message: 'Choose whether this was an expense or income.' };
  if (Number.isNaN(occurredAt.getTime())) return { success: false, message: 'The transaction date is invalid.' };

  try {
    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin
      .from('gmail_connections')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (connectionError || !connection) return { success: false, message: 'Connect Gmail before reviewing this alert.' };

    const { data: candidate, error: candidateError } = await admin
      .from('gmail_sync_messages')
      .select('id, gmail_message_id, received_at, sync_state, parse_status')
      .eq('id', input.candidateId)
      .eq('user_id', userId)
      .eq('connection_id', connection.id)
      .maybeSingle();
    if (candidateError || !candidate || candidate.sync_state !== 'pending' || !['needs_review', 'unrecognized'].includes(candidate.parse_status)) {
      return { success: false, message: 'This alert is no longer waiting for review. Refresh Finance and try again.' };
    }

    const { error: insertError } = await admin.from('transactions').insert({
      user_id: userId,
      amount,
      currency,
      direction,
      merchant: merchant || null,
      category: null,
      occurred_at: occurredAt.toISOString(),
      source: 'gmail',
      source_message_id: candidate.gmail_message_id,
    });
    if (insertError && insertError.code !== '23505') return { success: false, message: 'The transaction could not be saved. Apply the transaction review migration and try again.' };

    const { error: updateError } = await admin
      .from('gmail_sync_messages')
      .update({ sync_state: 'processed', parse_status: 'processed' })
      .eq('id', candidate.id)
      .eq('user_id', userId)
      .eq('connection_id', connection.id)
      .eq('sync_state', 'pending');
    if (updateError) return { success: false, message: 'The transaction is saved, but the alert status could not be updated. Refresh Finance to finish.' };

    revalidatePath('/');
    return { success: true, message: insertError ? 'This transaction was already saved. The alert is now marked reviewed.' : 'Transaction saved.' };
  } catch {
    return { success: false, message: 'The transaction could not be saved. Please refresh Finance and try again.' };
  }
}

export async function ignoreFinanceCandidateAction(candidateId: string): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before updating Gmail alerts.' };
  if (typeof candidateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidateId)) return { success: false, message: 'This alert is invalid.' };

  try {
    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin
      .from('gmail_connections')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (connectionError || !connection) return { success: false, message: 'Connect Gmail before updating this alert.' };

    const { data, error } = await admin
      .from('gmail_sync_messages')
      .update({ sync_state: 'ignored', parse_status: 'ignored' })
      .eq('id', candidateId)
      .eq('user_id', userId)
      .eq('connection_id', connection.id)
      .eq('sync_state', 'pending')
      .select('id')
      .maybeSingle();
    if (error || !data) return { success: false, message: 'This alert is no longer waiting for review. Refresh Finance and try again.' };

    revalidatePath('/');
    return { success: true, message: 'Alert ignored. No transaction was created.' };
  } catch {
    return { success: false, message: 'The alert could not be updated. Please try again.' };
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
      if (fallbackError) return { success: false, message: 'The transaction could not be saved. Apply the finance migrations and try again.' };
      revalidatePath('/');
      return {
        success: true,
        message: paymentMethod || note
          ? 'Transaction saved without payment method and note. Apply the manual-transactions migration to keep those details.'
          : 'Transaction saved.',
      };
    }
    if (error) return { success: false, message: 'The transaction could not be saved. Please try again.' };

    revalidatePath('/');
    return { success: true, message: direction === 'expense' ? 'Expense saved.' : 'Income saved.' };
  } catch {
    return { success: false, message: 'The transaction could not be saved. Please refresh Finance and try again.' };
  }
}

export async function deleteManualTransactionAction(transactionId: string): Promise<FinanceActionState> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before deleting a transaction.' };
  if (typeof transactionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(transactionId)) return { success: false, message: 'This transaction is invalid.' };

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

    revalidatePath('/');
    return { success: true, message: 'Transaction deleted.' };
  } catch {
    return { success: false, message: 'This transaction could not be deleted. Please try again.' };
  }
}
