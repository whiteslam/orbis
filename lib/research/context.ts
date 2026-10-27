// The owner's holdings as the desk sees them, and the portfolio context a run
// is given. Client-safe and pure. The worker never sees broker tokens: only
// what is here, in INR.

import { classifyHolding, type AssetClass } from '@/lib/invest/analysis';
import type { BrokerId } from '@/lib/invest/brokers';
import type { BrokerPortfolio } from '@/lib/invest/types';
import { researchTarget, type ResearchTarget } from '@/lib/research/tickers';
import type { PortfolioContext } from '@/lib/research/types';

export type DeskHolding = {
  /** Matches lib/invest/analysis's Position.key. */
  key: string;
  symbol: string;
  broker: BrokerId;
  assetClass: AssetClass;
  value: number;
  quantity: number;
  averagePrice: number;
  target: ResearchTarget;
};

/** Every holding from the accounts that loaded, largest first, with what the desk can do with it. */
export function deskHoldings(brokers: BrokerPortfolio[]): DeskHolding[] {
  return brokers
    .filter((portfolio) => portfolio.state === 'ok')
    .flatMap((portfolio) => portfolio.holdings.map((holding): DeskHolding => {
      const assetClass = classifyHolding(holding.symbol, holding.isin);
      return {
        key: `${portfolio.broker}:${holding.isin ?? holding.symbol}`,
        symbol: holding.symbol,
        broker: portfolio.broker,
        assetClass,
        value: holding.quantity * (holding.lastPrice ?? holding.averagePrice),
        quantity: holding.quantity,
        averagePrice: holding.averagePrice,
        target: researchTarget({ symbol: holding.symbol, isin: holding.isin, assetClass }),
      };
    }))
    .sort((left, right) => right.value - left.value);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The book for TradingAgents' Portfolio Manager: each listed position once,
 * the same ticker on two brokers merged at its weighted average price. Cash is
 * unknown (no broker here reports it), which upstream keeps distinct from zero.
 */
export function portfolioContextFor(holdings: DeskHolding[]): PortfolioContext {
  const merged = new Map<string, { quantity: number; cost: number }>();
  for (const holding of holdings) {
    if (!holding.target.ok) continue;
    const entry = merged.get(holding.target.ticker) ?? { quantity: 0, cost: 0 };
    entry.quantity += holding.quantity;
    entry.cost += holding.quantity * holding.averagePrice;
    merged.set(holding.target.ticker, entry);
  }
  return {
    currency: 'INR',
    cash: null,
    positions: [...merged].map(([ticker, entry]) => ({
      ticker,
      quantity: entry.quantity,
      average_price: entry.quantity > 0 ? round2(entry.cost / entry.quantity) : null,
    })),
  };
}
