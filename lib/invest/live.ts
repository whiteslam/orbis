import 'server-only';

import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { BROKERS, type BrokerId } from '@/lib/invest/brokers';
import { envGrowwCredentials, fetchGrowwPortfolio, GrowwAuthError, GrowwError, growwOwnerEmail } from '@/lib/invest/groww';
import { getGrowwConnection, recordGrowwSync, type GrowwConnectionLookup } from '@/lib/invest/groww-connection';
import { envZerodhaCredentials, fetchZerodhaPortfolio, ZerodhaAuthError, ZerodhaError } from '@/lib/invest/zerodha';
import { getZerodhaConnection, markZerodhaReconnect } from '@/lib/invest/zerodha-connection';
import type { BrokerPortfolio, LivePortfolioData } from '@/lib/invest/types';
import { CONNECTION_UNAVAILABLE } from '@/lib/errors';

/** Loads one account's holdings. Register a provider's loader here and it appears on the screen. */
type BrokerLoader = (userId: string, email: string | null) => Promise<BrokerPortfolio>;

const empty = (broker: BrokerId) => ({ broker, livePrices: false, fetchedAt: null, holdings: [], connection: null });

function growwFailure(error_: unknown) {
  return error_ instanceof GrowwError ? error_.message : 'Groww could not be reached. Try again shortly.';
}

type GrowwSaved = Extract<GrowwConnectionLookup, { kind: 'connected' }>['connection'];

/** A connection this user saved in Orbis. */
async function loadSavedGroww(userId: string, connection: GrowwSaved): Promise<BrokerPortfolio> {
  try {
    const data = await fetchGrowwPortfolio(connection.credentials);
    await recordGrowwSync(userId, 'ok');
    return { ...empty('groww'), state: 'ok', ...data, connection: { source: 'account', status: 'connected', lastSyncAt: data.fetchedAt } };
  } catch (error_) {
    const authFailed = error_ instanceof GrowwAuthError;
    if (authFailed) await recordGrowwSync(userId, 'auth_failed');
    return { ...empty('groww'), state: 'error', message: growwFailure(error_), connection: { source: 'account', status: authFailed ? 'reconnect_required' : connection.status, lastSyncAt: connection.lastSyncAt } };
  }
}

/** Server-wide keys from the environment. */
async function loadServerGroww(credentials: NonNullable<ReturnType<typeof envGrowwCredentials>>): Promise<BrokerPortfolio> {
  try {
    const data = await fetchGrowwPortfolio(credentials);
    return { ...empty('groww'), state: 'ok', ...data, connection: { source: 'server', status: 'connected', lastSyncAt: data.fetchedAt } };
  } catch (error_) {
    return { ...empty('groww'), state: 'error', message: growwFailure(error_), connection: { source: 'server', status: error_ instanceof GrowwAuthError ? 'reconnect_required' : 'connected', lastSyncAt: null } };
  }
}

/** Why the connect form cannot be used yet, if it cannot. */
function growwSetupMessage(lookup: GrowwConnectionLookup, encryptionReady: boolean) {
  if (lookup.kind === 'setup') return lookup.message;
  return encryptionReady ? undefined : CONNECTION_UNAVAILABLE;
}

async function loadGroww(userId: string, email: string | null): Promise<BrokerPortfolio> {
  let lookup: GrowwConnectionLookup;
  try {
    lookup = await getGrowwConnection(userId);
  } catch {
    lookup = { kind: 'setup', message: 'Groww connections are not available right now.' };
  }

  // 1. A connection this user saved in Orbis.
  if (lookup.kind === 'connected') return loadSavedGroww(userId, lookup.connection);

  // 2. Server-wide keys from the environment, only for their owner.
  const serverCredentials = envGrowwCredentials();
  const owner = growwOwnerEmail();
  if (serverCredentials && owner && email === owner) return loadServerGroww(serverCredentials);

  // 3. Not connected yet: the card offers the connect form.
  const encryptionReady = credentialEncryptionReady();
  return {
    ...empty('groww'),
    state: 'not_connected',
    setupRequired: lookup.kind === 'setup' || !encryptionReady,
    message: growwSetupMessage(lookup, encryptionReady),
  };
}

/**
 * Zerodha's session is the whole story here.
 *
 * Kite ends it overnight and cannot renew it without the user, so most states
 * this returns are about the session rather than about holdings. Saying
 * "reconnect" is the correct answer most mornings, and is not a failure.
 */
async function loadZerodha(userId: string): Promise<BrokerPortfolio> {
  const credentials = envZerodhaCredentials();
  if (!credentials) {
    console.error('Zerodha is not configured: ZERODHA_API_KEY and ZERODHA_API_SECRET are unset.');
    return { ...empty('zerodha'), state: 'not_connected', setupRequired: true, message: CONNECTION_UNAVAILABLE };
  }

  const lookup = await getZerodhaConnection(userId).catch(() => ({ kind: 'setup', message: 'Zerodha connections are not available right now.' } as const));
  if (lookup.kind === 'setup') return { ...empty('zerodha'), state: 'not_connected', setupRequired: true, message: lookup.message };
  if (lookup.kind === 'none') return { ...empty('zerodha'), state: 'not_connected' };
  if (lookup.kind === 'expired') {
    return {
      ...empty('zerodha'),
      state: 'not_connected',
      message: 'Zerodha ended the session overnight, as it always does. Connect again to see today’s holdings.',
      connection: { source: 'account', status: 'reconnect_required', lastSyncAt: lookup.lastSyncAt },
    };
  }

  try {
    const data = await fetchZerodhaPortfolio(credentials, lookup.session.accessToken);
    return { ...empty('zerodha'), state: 'ok', ...data, connection: { source: 'account', status: 'connected', lastSyncAt: data.fetchedAt } };
  } catch (error_) {
    // Kite rejecting the token means the same thing as an expired one.
    if (error_ instanceof ZerodhaAuthError) {
      await markZerodhaReconnect(userId);
      return {
        ...empty('zerodha'),
        state: 'not_connected',
        message: 'Zerodha ended the session. Connect again to see today’s holdings.',
        connection: { source: 'account', status: 'reconnect_required', lastSyncAt: lookup.session.lastSyncAt },
      };
    }
    return {
      ...empty('zerodha'),
      state: 'error',
      message: error_ instanceof ZerodhaError ? error_.message : 'Zerodha could not be reached. Try again shortly.',
      connection: { source: 'account', status: 'connected', lastSyncAt: lookup.session.lastSyncAt },
    };
  }
}

const LOADERS: Record<BrokerId, BrokerLoader> = {
  groww: loadGroww,
  zerodha: (userId) => loadZerodha(userId),
};

// One account failing is not the whole screen failing, so each loader's error is
// carried on its own card rather than thrown.
export async function loadLivePortfolio(userId: string, email: string | null): Promise<LivePortfolioData> {
  const brokers = await Promise.all(BROKERS.map(async (broker): Promise<BrokerPortfolio> => {
    try {
      return await LOADERS[broker.id](userId, email);
    } catch {
      return { ...empty(broker.id), state: 'error', message: `${broker.name} could not be reached. Try again shortly.` };
    }
  }));
  return { brokers };
}
