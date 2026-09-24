// Portfolio maths shared by the Invest dashboard and the AI suggestions action.
// Client-safe: no server imports.
import type { GrowwHolding, InvestmentHolding, LivePrice } from '@/lib/invest/types';

export type AssetClass = 'Stocks' | 'Gold & silver' | 'ETFs' | 'Mutual funds' | 'Crypto' | 'Cash' | 'Other';

export type Position = {
  key: string;
  name: string;
  source: 'groww' | 'manual';
  assetClass: AssetClass;
  value: number;
  invested: number | null;
  live: boolean;
};

export type Status = 'good' | 'warning' | 'critical';

export type PortfolioAnalysis = {
  positions: Position[];
  total: number;
  invested: number | null;
  allLive: boolean;
  livePnl: number | null;
  liveInvested: number;
  byClass: Array<{ assetClass: AssetClass; value: number; share: number }>;
  largest: { name: string; share: number } | null;
  effectiveHoldings: number;
  concentration: Status;
  diversification: Status;
  mix: Status;
  excludedCurrencies: string[];
};

// Fixed order, so each asset class keeps its colour wherever it appears.
export const ASSET_CLASSES: AssetClass[] = ['Stocks', 'ETFs', 'Mutual funds', 'Gold & silver', 'Crypto', 'Cash', 'Other'];

// Indian ISINs starting with INF are fund/ETF units; INE are company shares.
function classifyGroww(symbol: string, isin: string | null): AssetClass {
  const value = symbol.toUpperCase();
  if (/GOLD|SILVER|SILV/.test(value)) return 'Gold & silver';
  if (isin?.toUpperCase().startsWith('INF') || /BEES|ETF|NIFTY|SENSEX|IETF/.test(value)) return 'ETFs';
  return 'Stocks';
}

const manualClass: Record<InvestmentHolding['assetType'], AssetClass> = {
  stock: 'Stocks',
  etf: 'ETFs',
  fund: 'Mutual funds',
  crypto: 'Crypto',
  cash: 'Cash',
  other: 'Other',
};

export function analysePortfolio(
  groww: GrowwHolding[],
  manual: InvestmentHolding[],
  live: { manualPrices?: Record<string, LivePrice>; fxToInr?: Record<string, number> | null } = {},
): PortfolioAnalysis {
  const positions: Position[] = [];
  let invested = 0;
  let investedKnown = true;

  for (const holding of groww) {
    const cost = holding.quantity * holding.averagePrice;
    positions.push({
      key: `groww:${holding.isin ?? holding.symbol}`,
      name: holding.symbol,
      source: 'groww',
      assetClass: classifyGroww(holding.symbol, holding.isin),
      value: holding.lastPrice === null ? cost : holding.quantity * holding.lastPrice,
      invested: cost,
      live: holding.lastPrice !== null,
    });
    invested += cost;
  }

  // Totals are in INR. AMFI and CoinGecko prices are already INR; everything
  // else is in the holding's currency and converted when a rate is available.
  const excluded = new Set<string>();
  for (const holding of manual) {
    const price = live.manualPrices?.[holding.id];
    const inInr = price && (price.source === 'amfi' || price.source === 'coingecko');
    const rate = inInr || holding.currency === 'INR' ? 1 : live.fxToInr?.[holding.currency];
    if (!rate) {
      excluded.add(holding.currency);
      continue;
    }
    positions.push({
      key: `manual:${holding.id}`,
      name: holding.name,
      source: 'manual',
      assetClass: manualClass[holding.assetType],
      value: holding.quantity * (price ? price.price : holding.valuePerUnit) * rate,
      invested: null,
      live: Boolean(price),
    });
    investedKnown = false;
  }

  positions.sort((left, right) => right.value - left.value);
  const total = positions.reduce((sum, position) => sum + position.value, 0);
  const weights = total > 0 ? positions.map((position) => position.value / total) : [];
  const effectiveHoldings = weights.length ? 1 / weights.reduce((sum, weight) => sum + weight * weight, 0) : 0;
  const byClass = ASSET_CLASSES
    .map((assetClass) => {
      const value = positions.filter((position) => position.assetClass === assetClass).reduce((sum, position) => sum + position.value, 0);
      return { assetClass, value, share: total > 0 ? value / total : 0 };
    })
    .filter((item) => item.value > 0);
  const largest = positions[0] && total > 0 ? { name: positions[0].name, share: positions[0].value / total } : null;

  const pnlPositions = positions.filter((position) => position.live && position.invested !== null);
  const liveInvested = pnlPositions.reduce((sum, position) => sum + (position.invested ?? 0), 0);

  return {
    positions,
    total,
    invested: investedKnown && positions.length ? invested : null,
    allLive: positions.length > 0 && positions.every((position) => position.live),
    livePnl: pnlPositions.length ? pnlPositions.reduce((sum, position) => sum + position.value, 0) - liveInvested : null,
    liveInvested,
    byClass,
    largest,
    effectiveHoldings,
    concentration: !largest || largest.share <= 0.25 ? 'good' : largest.share <= 0.4 ? 'warning' : 'critical',
    diversification: effectiveHoldings >= 8 ? 'good' : effectiveHoldings >= 4 ? 'warning' : 'critical',
    mix: byClass.length >= 3 ? 'good' : byClass.length === 2 ? 'warning' : 'critical',
    excludedCurrencies: Array.from(excluded),
  };
}

export type ProjectionPoint = { year: number; value: number; contributed: number };

export function projectGrowth(start: number, monthly: number, annualReturnPercent: number, years: number): ProjectionPoint[] {
  const monthlyRate = annualReturnPercent / 100 / 12;
  const points: ProjectionPoint[] = [{ year: 0, value: start, contributed: start }];
  let value = start;
  let contributed = start;
  for (let month = 1; month <= years * 12; month += 1) {
    value = value * (1 + monthlyRate) + monthly;
    contributed += monthly;
    if (month % 12 === 0) points.push({ year: month / 12, value: Math.round(value), contributed: Math.round(contributed) });
  }
  return points;
}
