// Portfolio maths shared by the Invest dashboard and the AI suggestions action.
// Client-safe: no server imports.
//
// It takes whatever accounts were loaded, so a new provider needs no change
// here beyond a classifier if its instruments don't look like the others'.
import type { BrokerId } from '@/lib/invest/brokers';
import type { BrokerHolding, BrokerPortfolio } from '@/lib/invest/types';

export type AssetClass = 'Stocks' | 'Gold & silver' | 'ETFs' | 'Mutual funds' | 'Crypto' | 'Cash' | 'Other';

export type Position = {
  key: string;
  name: string;
  broker: BrokerId;
  assetClass: AssetClass;
  value: number;
  invested: number;
  live: boolean;
  /** Today's move, where the price source reports one. */
  dayChangePercent: number | null;
};

export type Status = 'good' | 'warning' | 'critical';

export type PortfolioAnalysis = {
  positions: Position[];
  total: number;
  invested: number;
  allLive: boolean;
  livePnl: number | null;
  liveInvested: number;
  byClass: Array<{ assetClass: AssetClass; value: number; share: number }>;
  largest: { name: string; share: number } | null;
  effectiveHoldings: number;
  concentration: Status;
  diversification: Status;
  mix: Status;
  /**
   * Today's move, over the positions whose price source reports one.
   *
   * `coverage` is the share of the portfolio those positions represent, so a
   * figure drawn from a quarter of the holdings is never shown as the whole
   * portfolio's day. Null when nothing reports a day change at all.
   */
  dayChange: { value: number; percent: number; coverage: number } | null;
};

// Fixed order, so each asset class keeps its colour wherever it appears.
export const ASSET_CLASSES: AssetClass[] = ['Stocks', 'ETFs', 'Mutual funds', 'Gold & silver', 'Crypto', 'Cash', 'Other'];

// Indian ISINs starting with INF are fund/ETF units; INE are company shares.
export function classifyHolding(symbol: string, isin: string | null): AssetClass {
  const value = symbol.toUpperCase();
  if (/GOLD|SILVER|SILV/.test(value)) return 'Gold & silver';
  if (isin?.toUpperCase().startsWith('INF') || /BEES|ETF|NIFTY|SENSEX|IETF/.test(value)) return 'ETFs';
  return 'Stocks';
}

function toPosition(broker: BrokerId, holding: BrokerHolding): Position {
  const cost = holding.quantity * holding.averagePrice;
  return {
    key: `${broker}:${holding.isin ?? holding.symbol}`,
    name: holding.symbol,
    broker,
    assetClass: classifyHolding(holding.symbol, holding.isin),
    // Without a price the holding still counts, at what it cost — a stale number
    // beats dropping the position out of the totals.
    value: holding.lastPrice === null ? cost : holding.quantity * holding.lastPrice,
    invested: cost,
    live: holding.lastPrice !== null,
    dayChangePercent: holding.lastPrice === null ? null : holding.dayChangePercent,
  };
}

export function analysePortfolio(portfolios: BrokerPortfolio[]): PortfolioAnalysis {
  const positions = portfolios
    .filter((portfolio) => portfolio.state === 'ok')
    .flatMap((portfolio) => portfolio.holdings.map((holding) => toPosition(portfolio.broker, holding)))
    .sort((left, right) => right.value - left.value);

  const total = positions.reduce((sum, position) => sum + position.value, 0);
  const invested = positions.reduce((sum, position) => sum + position.invested, 0);
  const weights = total > 0 ? positions.map((position) => position.value / total) : [];
  const effectiveHoldings = weights.length ? 1 / weights.reduce((sum, weight) => sum + weight * weight, 0) : 0;
  const byClass = ASSET_CLASSES
    .map((assetClass) => {
      const value = positions.filter((position) => position.assetClass === assetClass).reduce((sum, position) => sum + position.value, 0);
      return { assetClass, value, share: total > 0 ? value / total : 0 };
    })
    .filter((item) => item.value > 0);
  const largest = positions[0] && total > 0 ? { name: positions[0].name, share: positions[0].value / total } : null;

  // Gain is only claimed where a live price exists; entered-at-cost positions
  // would otherwise report a flat zero as though it were measured.
  const pnlPositions = positions.filter((position) => position.live);
  const liveInvested = pnlPositions.reduce((sum, position) => sum + position.invested, 0);

  // Only AMFI NAV and exchange quotes carry a previous close; Groww's own LTP
  // does not. So the day is measured over the positions that report one, and
  // carries how much of the portfolio that actually was.
  const moved = positions.filter((position) => position.dayChangePercent !== null);
  const movedValue = moved.reduce((sum, position) => sum + position.value, 0);
  const dayValue = moved.reduce((sum, position) => {
    const percent = position.dayChangePercent ?? 0;
    // value already includes today's move, so the opening value is value / (1 + pct).
    return sum + (position.value - position.value / (1 + percent / 100));
  }, 0);

  return {
    positions,
    total,
    invested,
    allLive: positions.length > 0 && positions.every((position) => position.live),
    livePnl: pnlPositions.length ? pnlPositions.reduce((sum, position) => sum + position.value, 0) - liveInvested : null,
    liveInvested,
    byClass,
    largest,
    effectiveHoldings,
    concentration: !largest || largest.share <= 0.25 ? 'good' : largest.share <= 0.4 ? 'warning' : 'critical',
    diversification: effectiveHoldings >= 8 ? 'good' : effectiveHoldings >= 4 ? 'warning' : 'critical',
    mix: byClass.length >= 3 ? 'good' : byClass.length === 2 ? 'warning' : 'critical',
    dayChange: moved.length && movedValue > 0
      ? { value: dayValue, percent: (dayValue / (movedValue - dayValue)) * 100, coverage: total > 0 ? movedValue / total : 0 }
      : null,
  };
}
