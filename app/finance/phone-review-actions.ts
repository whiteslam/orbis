'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { acceptPhoneTransaction, dismissPhoneTransaction, type AcceptPhoneTransactionInput } from '@/lib/finance/phone-review';
import { createClient } from '@/lib/supabase/server';

type Result = { success: boolean; message: string };

export async function acceptPhoneTransactionAction(input: AcceptPhoneTransactionInput): Promise<Result> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before saving this payment.' };
  try {
    const result = await acceptPhoneTransaction(await createClient(), userId, input);
    if (result.success) revalidatePath('/active');
    return result;
  } catch {
    return { success: false, message: 'The payment could not be saved. Please refresh Money and try again.' };
  }
}

export async function dismissPhoneTransactionAction(signalId: string): Promise<Result> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again before dismissing this payment.' };
  try {
    const result = await dismissPhoneTransaction(await createClient(), userId, signalId);
    if (result.success) revalidatePath('/active');
    return result;
  } catch {
    return { success: false, message: 'The payment could not be dismissed. Please try again.' };
  }
}
