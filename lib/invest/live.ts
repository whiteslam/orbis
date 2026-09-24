import 'server-only';

import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { BROKERS, type BrokerId } from '@/lib/invest/brokers';
import { envGrowwCredentials, fetchGrowwPortfolio, GrowwAuthError, GrowwError, growwOwnerEmail } from '@/lib/invest/groww';
import { getGrowwConnection, recordGrowwSync, type GrowwConnectionLookup } from '@/lib/invest/groww-connection';
import type { BrokerPortfolio, LivePortfolioData } from '@/lib/invest/types';

/** Loads one account's holdings. Register a provider's loader here and it appears on the screen. */
type BrokerLoader = (userId: string, email: string | null) => Promise<BrokerPortfolio>;

const empty = (broker: BrokerId) => ({ broker, livePrices: false, fetchedAt: null, holdings: [], connection: null });

function growwFailure(caught: unknown) {
  return caught instanceof GrowwError ? caught.message : 'Groww could not be reached. Try again shortly.';
}

async function loadGroww(userId: string, email: string | null): Promise<BrokerPortfolio> {
  let lookup: GrowwConnectionLookup;
  try {
    lookup = await getGrowwConnection(userId);
  } catch {
    lookup = { kind: 'setup', message: 'Groww connections are not available right now.' };
  }

  // 1. A connection this user saved in Orbis.
  if (lookup.kind === 'connected') {
    const { connection } = lookup;
    try {
      const data = await fetchGrowwPortfolio(connection.credentials);
      await recordGrowwSync(userId, 'ok');
      return { ...empty('groww'), state: 'ok', ...data, connection: { source: 'account', status: 'connected', lastSyncAt: data.fetchedAt } };
    } catch (caught) {
      const authFailed = caught instanceof GrowwAuthError;
      if (authFailed) await recordGrowwSync(userId, 'auth_failed');
      return { ...empty('groww'), state: 'error', message: growwFailure(caught), connection: { source: 'account', status: authFailed ? 'reconnect_required' : connection.status, lastSyncAt: connection.lastSyncAt } };
    }
  }

  // 2. Server-wide keys from the environment, only for their owner.
  const serverCredentials = envGrowwCredentials();
  const owner = growwOwnerEmail();
  if (serverCredentials && owner && email === owner) {
    try {
      const data = await fetchGrowwPortfolio(serverCredentials);
      return { ...empty('groww'), state: 'ok', ...data, connection: { source: 'server', status: 'connected', lastSyncAt: data.fetchedAt } };
    } catch (caught) {
      return { ...empty('groww'), state: 'error', message: growwFailure(caught), connection: { source: 'server', status: caught instanceof GrowwAuthError ? 'reconnect_required' : 'connected', lastSyncAt: null } };
    }
  }

  // 3. Not connected yet: the card offers the connect form.
  const encryptionReady = credentialEncryptionReady();
  return {
    ...empty('groww'),
    state: 'not_connected',
    setupRequired: lookup.kind === 'setup' || !encryptionReady,
    message: lookup.kind === 'setup' ? lookup.message : encryptionReady ? undefined : 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY).',
  };
}

const LOADERS: Record<BrokerId, BrokerLoader> = {
  groww: loadGroww,
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
