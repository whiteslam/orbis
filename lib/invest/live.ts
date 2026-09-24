import 'server-only';

import { fetchGrowwPortfolio, growwConfigured, growwOwnerEmail, GrowwError } from '@/lib/invest/groww';
import type { GrowwPortfolio, InvestmentHolding, LivePortfolioData, LivePrice } from '@/lib/invest/types';
import { friendlyProviderMessage } from '@/lib/providers/core';
import { getCryptoPrices } from '@/lib/providers/crypto';
import { getRatesToInr } from '@/lib/providers/currency';
import { getFundNavs, getStockQuotes } from '@/lib/providers/markets';

const emptyGroww = { livePrices: false, fetchedAt: null, holdings: [] };

async function loadGroww(email: string | null): Promise<GrowwPortfolio> {
  if (!growwConfigured()) return { ...emptyGroww, state: 'not_configured' };
  // The Groww keys unlock one brokerage account, so only its owner may read it.
  const owner = growwOwnerEmail();
  if (!owner) return { ...emptyGroww, state: 'owner_not_set' };
  if (email !== owner) return { ...emptyGroww, state: 'not_owner' };
  try {
    return { state: 'ok', ...(await fetchGrowwPortfolio()) };
  } catch (caught) {
    return { ...emptyGroww, state: 'error', message: caught instanceof GrowwError ? caught.message : 'Groww could not be reached. Try again shortly.' };
  }
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

export async function loadLivePortfolio(email: string | null, manual: InvestmentHolding[]): Promise<LivePortfolioData> {
  const needsFx = manual.some((holding) => holding.currency !== 'INR' && holding.marketSource !== 'amfi' && holding.marketSource !== 'coingecko');
  const [groww, manualResult, fx] = await Promise.all([
    loadGroww(email),
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
