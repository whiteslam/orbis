'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { brokerMeta, isBrokerId, type BrokerId } from '@/lib/invest/brokers';
import { loadLivePortfolio } from '@/lib/invest/live';
import { getAccessToken, GrowwAuthError, GrowwError } from '@/lib/invest/groww';
import { deleteGrowwConnection, saveGrowwConnection } from '@/lib/invest/groww-connection';
import { deleteZerodhaConnection } from '@/lib/invest/zerodha-connection';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import type { LivePortfolioData } from '@/lib/invest/types';
import { analysePortfolio } from '@/lib/invest/analysis';
import type { BriefPortfolio } from '@/lib/home/portfolio';

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
      return;
    case 'zerodha':
      // Kite has no key-and-secret path: a session only comes from its own
      // login, which /auth/zerodha/start handles.
      throw new Error('Zerodha is connected by logging in at Zerodha, not with a key and secret.');
  }
}

async function forget(broker: BrokerId, userId: string) {
  switch (broker) {
    case 'groww':
      await deleteGrowwConnection(userId);
      return;
    case 'zerodha':
      await deleteZerodhaConnection(userId);
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

/**
 * The portfolio reduced to what the Home brief says about it.
 *
 * Home asks for this on every visit, so it returns the small shape rather than
 * every holding, and reports 'off' instead of zeros when nothing is linked.
 */
export async function loadBriefPortfolioAction(): Promise<BriefPortfolio> {
  const off: BriefPortfolio = { state: 'off', total: 0, invested: 0, holdingCount: 0, gain: null, day: null, largest: null };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return off;
  const email = typeof data?.claims?.email === 'string' ? data.claims.email.toLowerCase() : null;

  const live = await loadLivePortfolio(userId, email);
  if (!live.brokers.some((broker) => broker.state === 'ok')) return off;
  const analysis = analysePortfolio(live.brokers);
  if (!analysis.positions.length) return off;

  return {
    state: 'ok',
    total: analysis.total,
    invested: analysis.invested,
    holdingCount: analysis.positions.length,
    gain: analysis.livePnl,
    day: analysis.dayChange,
    largest: analysis.largest,
  };
}
