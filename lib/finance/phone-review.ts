import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptForUser } from '@/lib/crypto/user-keys';
import { phoneTablesMissing } from '@/lib/device/not-set-up';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance/manual';
import { isMissingTable } from '@/lib/supabase/errors';
import { isUuid } from '@/lib/validate/id';

// Payments the phone spotted in notifications wait in `signals` (kind
// 'transaction'), encrypted. Money shows them for review; accepting one saves an
// ordinary transaction and removes the signal. Nothing here logs a signal's content.

export { reviewLine } from '@/lib/finance/phone-review-line';

export type PhoneTransaction = {
  signalId: string;
  amount: number;
  currency: string;
  direction: 'expense' | 'income';
  merchant: string | null;
  occurredAt: string;
  text: string;
};

export type PhoneReviewResult = { success: boolean; message: string };

export type AcceptPhoneTransactionInput = {
  signalId: string;
  category: string;
  merchant?: string;
  direction?: 'expense' | 'income';
};

const MAX_LISTED = 50;
const MAX_AMOUNT = 100_000_000;
const MERCHANT_MAX = 100;

/** The phone's decrypted transaction JSON as a PhoneTransaction, or null when it isn't one we can trust. */
export function readTransactionSignal(signalId: string, occurredAt: string, json: string): PhoneTransaction | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.v !== 1) return null;

  const raw = body.amount;
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  const cents = Math.round(amount * 100) / 100;
  if (cents <= 0) return null;

  if (body.direction !== 'expense' && body.direction !== 'income') return null;
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) return null;

  const merchant = typeof body.merchant === 'string' && body.merchant.trim() ? body.merchant.trim().slice(0, MERCHANT_MAX) : null;
  return {
    signalId,
    amount: cents,
    currency: body.currency,
    direction: body.direction,
    merchant,
    occurredAt,
    text: typeof body.text === 'string' ? body.text : '',
  };
}

function openSignal(userId: string, row: { id?: unknown; occurred_at?: unknown; content?: unknown }): PhoneTransaction | null {
  if (typeof row.id !== 'string' || typeof row.occurred_at !== 'string' || typeof row.content !== 'string') return null;
  try {
    return readTransactionSignal(row.id, row.occurred_at, decryptForUser(userId, row.content, row.id));
  } catch {
    return null;
  }
}

/** Phone payments waiting for review, newest first. Rows that can't be opened are left out. */
export async function listPhoneTransactions(db: SupabaseClient, userId: string): Promise<PhoneTransaction[]> {
  const { data, error } = await db
    .from('signals')
    .select('id, occurred_at, content')
    .eq('user_id', userId)
    .eq('source', 'notifications')
    .eq('kind', 'transaction')
    .order('occurred_at', { ascending: false })
    .limit(MAX_LISTED);
  if (error && phoneTablesMissing(error)) return [];
  if (error) throw new Error('Phone payments could not be loaded.');

  const opened: PhoneTransaction[] = [];
  let skipped = 0;
  for (const row of (data ?? []) as Array<{ id?: unknown; occurred_at?: unknown; content?: unknown }>) {
    const transaction = openSignal(userId, row);
    if (transaction) opened.push(transaction);
    else skipped += 1;
  }
  if (skipped) console.error(`Phone payments: ${skipped} could not be read and were left out`);
  return opened;
}

async function deleteSignal(db: SupabaseClient, userId: string, signalId: string) {
  return db
    .from('signals')
    .delete()
    .eq('id', signalId)
    .eq('user_id', userId)
    .eq('source', 'notifications')
    .eq('kind', 'transaction');
}

/**
 * Saves a waiting phone payment as a transaction. The amount, currency and date come
 * from the signal read here on the server, never from the caller. Accepting the same
 * payment again reports it as already saved and still clears the signal.
 */
export async function acceptPhoneTransaction(db: SupabaseClient, userId: string, input: AcceptPhoneTransactionInput): Promise<PhoneReviewResult> {
  if (!input || typeof input !== 'object' || !isUuid(input.signalId) || typeof input.category !== 'string') {
    return { success: false, message: 'This payment is invalid. Refresh Money and try again.' };
  }
  if (input.direction !== undefined && input.direction !== 'expense' && input.direction !== 'income') {
    return { success: false, message: 'Choose whether this was an expense or income.' };
  }
  if (input.merchant !== undefined && typeof input.merchant !== 'string') {
    return { success: false, message: 'This payment is invalid. Refresh Money and try again.' };
  }

  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category) && !(INCOME_CATEGORIES as readonly string[]).includes(input.category)) {
    return { success: false, message: 'Choose a category.' };
  }

  const { data: row, error: readError } = await db
    .from('signals')
    .select('id, occurred_at, content')
    .eq('id', input.signalId)
    .eq('user_id', userId)
    .eq('source', 'notifications')
    .eq('kind', 'transaction')
    .maybeSingle();
  if (readError && phoneTablesMissing(readError)) return { success: false, message: 'That payment is no longer waiting.' };
  if (readError) return { success: false, message: 'The payment could not be read. Please try again.' };
  const payment = row ? openSignal(userId, row) : null;
  if (!payment) return { success: false, message: 'That payment is no longer waiting.' };

  const direction = input.direction ?? payment.direction;
  const categories: readonly string[] = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (!categories.includes(input.category)) return { success: false, message: 'Choose a category.' };
  const merchant = input.merchant === undefined ? payment.merchant : input.merchant.trim().slice(0, MERCHANT_MAX) || null;

  const { error: insertError } = await db.from('transactions').insert({
    user_id: userId,
    amount: payment.amount,
    currency: payment.currency,
    direction,
    merchant,
    category: input.category,
    occurred_at: new Date(payment.occurredAt).toISOString(),
    source: 'phone',
    source_signal_id: payment.signalId,
    source_message_id: null,
    payment_method: null,
    note: null,
  });

  const alreadySaved = insertError?.code === '23505';
  if (insertError && !alreadySaved) {
    // Without the phone-transactions migration the column is missing (or the source check refuses 'phone').
    const notReady = isMissingTable(insertError) || insertError.code === '23514';
    console.error('Saving a phone payment failed', insertError.code ?? 'unknown');
    return {
      success: false,
      message: notReady ? 'Phone payments can’t be saved until Orbis finishes updating.' : 'The payment could not be saved. Please try again.',
    };
  }

  // A failed delete is harmless: the payment stays listed, and accepting it again
  // reads as already saved and tries the delete again.
  const { error: deleteError } = await deleteSignal(db, userId, payment.signalId);
  if (deleteError) console.error('Clearing an accepted phone payment failed', deleteError.code ?? 'unknown');

  return { success: true, message: alreadySaved ? 'Already in Money.' : direction === 'expense' ? 'Expense saved.' : 'Income saved.' };
}

/** Removes a waiting phone payment without saving it. */
export async function dismissPhoneTransaction(db: SupabaseClient, userId: string, signalId: string): Promise<PhoneReviewResult> {
  if (!isUuid(signalId)) return { success: false, message: 'This payment is invalid. Refresh Money and try again.' };
  const { error } = await deleteSignal(db, userId, signalId);
  if (error && phoneTablesMissing(error)) return { success: true, message: 'Dismissed.' };
  if (error) return { success: false, message: 'The payment could not be dismissed. Please try again.' };
  return { success: true, message: 'Dismissed.' };
}
