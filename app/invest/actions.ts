'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { brokerMeta, isBrokerId, type BrokerId } from '@/lib/invest/brokers';
import { loadLivePortfolio } from '@/lib/invest/live';
import { getAccessToken, GrowwAuthError, GrowwError } from '@/lib/invest/groww';
import { deleteGrowwConnection, saveGrowwConnection } from '@/lib/invest/groww-connection';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import type { LivePortfolioData } from '@/lib/invest/types';

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

export async function loadInvestLiveAction(): Promise<LivePortfolioData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  const email = typeof data?.claims?.email === 'string' ? data.claims.email.toLowerCase() : null;
  return loadLivePortfolio(userId, email);
}

/**
 * Checking and storing credentials is per provider: each one validates its own
 * keys and owns its own encrypted row. A new broker adds a case to each switch
 * and nothing else changes.
 */
type Credentials = { apiKey: string; apiSecret: string };

async function verifyAndSave(broker: BrokerId, userId: string, credentials: Credentials) {
  switch (broker) {
    case 'groww':
      await getAccessToken(credentials);
      await saveGrowwConnection(userId, credentials);
  }
}

async function forget(broker: BrokerId, userId: string) {
  switch (broker) {
    case 'groww':
      await deleteGrowwConnection(userId);
  }
}

// Checks the key and secret with the broker before saving them encrypted for this user.
export async function connectBrokerAction(input: { broker: string; apiKey: string; apiSecret: string }) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to connect this account.' };
  if (!input || typeof input !== 'object' || !isBrokerId(input.broker) || typeof input.apiKey !== 'string' || typeof input.apiSecret !== 'string') return { success: false, message: 'Enter your API key and secret.' };
  const meta = brokerMeta(input.broker);

  const apiKey = input.apiKey.replace(/\s+/g, '');
  const apiSecret = input.apiSecret.trim();
  if (apiKey.length < 20 || apiKey.length > 4000 || !/^[A-Za-z0-9._-]+$/.test(apiKey)) return { success: false, message: `That doesn’t look like a ${meta.name} ${meta.fields.key.toLowerCase()}. Copy the full key from the ${meta.keysLabel} page.` };
  if (apiSecret.length < 8 || apiSecret.length > 200 || /\s/.test(apiSecret)) return { success: false, message: `That doesn’t look like a ${meta.name} ${meta.fields.secret.toLowerCase()}. Copy it exactly as shown.` };
  if (!credentialEncryptionReady()) return { success: false, message: 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY) first.' };

  try {
    await verifyAndSave(input.broker, auth.userId, { apiKey, apiSecret });
  } catch (error) {
    if (error instanceof GrowwAuthError) return { success: false, message: `${meta.name} didn’t accept this key and secret. Check both, and approve the key on the ${meta.keysLabel} page if it asks.` };
    if (error instanceof GrowwError) return { success: false, message: error.message };
    return { success: false, message: error instanceof Error ? error.message : `${meta.name} could not be reached. Try again shortly.` };
  }
  revalidatePath('/');
  return { success: true, message: `${meta.name} connected. Syncing your holdings…` };
}

export async function disconnectBrokerAction(broker: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to disconnect this account.' };
  if (!isBrokerId(broker)) return { success: false, message: 'That account is not connected.' };
  const meta = brokerMeta(broker);
  try {
    await forget(broker, auth.userId);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : `${meta.name} could not be disconnected.` };
  }
  revalidatePath('/');
  return { success: true, message: `${meta.name} disconnected. Your saved key and secret were deleted from Orbis.` };
}
