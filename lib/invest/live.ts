import 'server-only';

import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { envGrowwCredentials, fetchGrowwPortfolio, GrowwAuthError, GrowwError, growwOwnerEmail } from '@/lib/invest/groww';
import { getGrowwConnection, recordGrowwSync, type GrowwConnectionLookup } from '@/lib/invest/groww-connection';
import type { GrowwPortfolio, InvestmentHolding, LivePortfolioData, LivePrice } from '@/lib/invest/types';
import { friendlyProviderMessage } from '@/lib/providers/core';
import { getCryptoPrices } from '@/lib/providers/crypto';
import { getRatesToInr } from '@/lib/providers/currency';
import { getFundNavs, getStockQuotes } from '@/lib/providers/markets';

const emptyGroww = { livePrices: false, fetchedAt: null, holdings: [], connection: null };

function growwFailure(caught: unknown) {
  return caught instanceof GrowwError ? caught.message : 'Groww could not be reached. Try again shortly.';
}

async function loadGroww(userId: string, email: string | null): Promise<GrowwPortfolio> {
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
      return { state: 'ok', ...data, connection: { source: 'account', status: 'connected', lastSyncAt: data.fetchedAt } };
    } catch (caught) {
      const authFailed = caught instanceof GrowwAuthError;
      if (authFailed) await recordGrowwSync(userId, 'auth_failed');
      return { ...emptyGroww, state: 'error', message: growwFailure(caught), connection: { source: 'account', status: authFailed ? 'reconnect_required' : connection.status, lastSyncAt: connection.lastSyncAt } };
    }
  }

  // 2. Server-wide keys from the environment, only for their owner.
  const serverCredentials = envGrowwCredentials();
  const owner = growwOwnerEmail();
  if (serverCredentials && owner && email === owner) {
    try {
      const data = await fetchGrowwPortfolio(serverCredentials);
      return { state: 'ok', ...data, connection: { source: 'server', status: 'connected', lastSyncAt: data.fetchedAt } };
    } catch (caught) {
      return { ...emptyGroww, state: 'error', message: growwFailure(caught), connection: { source: 'server', status: caught instanceof GrowwAuthError ? 'reconnect_required' : 'connected', lastSyncAt: null } };
    }
  }

  // 3. Not connected yet: the card offers the connect form.
  const encryptionReady = credentialEncryptionReady();
  return {
    ...emptyGroww,
    state: 'not_connected',
    setupRequired: lookup.kind === 'setup' || !encryptionReady,
    message: lookup.kind === 'setup' ? lookup.message : encryptionReady ? undefined : 'Secure storage is not configured on the server. Set CREDENTIAL_ENCRYPTION_KEY (or GMAIL_TOKEN_ENCRYPTION_KEY).',
  };
}

async function loadManualPrices(holdings: InvestmentHolding[]) {
  const linked = holdings.filter((holding) => holding.marketSymbol && holding.marketSource);
  const bySource = (source: InvestmentHolding['marketSource']) => linked.filter((holding) => holding.marketSource === source).map((holding) => holding.marketSymbol!);
  const [quotes, navs, coins] = await Promise.all([
    getStockQuotes(bySource('alpha_vantage')),
    getFundNavs(bySource('amfi')),
    getCryptoPrices(bySource('coingecko')),
  ]);

  const prices: Record<string, LivePrice> = {};
  for (const holding of linked) {
    const symbol = holding.marketSymbol!;
    const price = holding.marketSource === 'alpha_vantage' ? quotes.get(symbol.toUpperCase())
      : holding.marketSource === 'amfi' ? navs.get(symbol.toUpperCase())
        : coins.get(symbol.toLowerCase());
    if (price && (price.source === 'alpha_vantage' || price.source === 'amfi' || price.source === 'coingecko')) {
      prices[holding.id] = { price: price.price, changePercent: price.changePercent, asOf: price.asOf, source: price.source, stale: price.stale };
    }
  }
  return { prices, missing: linked.filter((holding) => !prices[holding.id]).map((holding) => holding.name) };
}

export async function loadLivePortfolio(userId: string, email: string | null, manual: InvestmentHolding[]): Promise<LivePortfolioData> {
  const needsFx = manual.some((holding) => holding.currency !== 'INR' && holding.marketSource !== 'amfi' && holding.marketSource !== 'coingecko');
  const [groww, manualResult, fx] = await Promise.all([
    loadGroww(userId, email),
    loadManualPrices(manual),
    needsFx ? getRatesToInr().catch((error: unknown) => error) : Promise.resolve(null),
  ]);

  const notices: string[] = [];
  if (manualResult.missing.length) notices.push(`No live price for ${manualResult.missing.slice(0, 3).join(', ')}${manualResult.missing.length > 3 ? ' and others' : ''}, so ${manualResult.missing.length === 1 ? 'it uses' : 'they use'} the value you entered.`);
  if (fx instanceof Error) notices.push(friendlyProviderMessage(fx));
  const fxData = fx && !(fx instanceof Error) ? fx as Awaited<ReturnType<typeof getRatesToInr>> : null;
  if (fxData?.stale) notices.push('Currency rates could not be refreshed, so the last saved rates are used.');

  return {
    groww,
    manualPrices: manualResult.prices,
    fxToInr: fxData?.data ?? null,
    fxDate: fxData?.fetchedAt ?? null,
    notices,
  };
}
