import type { BrokerId } from '@/lib/invest/brokers';

/** Market data providers used to fill a price the broker itself did not give. */
export type MarketSource = 'alpha_vantage' | 'coingecko' | 'amfi';

/** Who priced a holding: the broker's own feed, or a market data provider. */
export type PriceSource = BrokerId | MarketSource;

export type BrokerHolding = {
  symbol: string;
  isin: string | null;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  /** Today's move on this holding, where the price source reports one. */
  dayChangePercent: number | null;
  priceSource: PriceSource | null;
  priceAsOf: string | null;
  priceStale: boolean;
};

export type BrokerConnection = {
  // How this account is linked: saved in Orbis by the user, or server env keys.
  source: 'account' | 'server';
  status: 'connected' | 'reconnect_required';
  lastSyncAt: string | null;
};

export type BrokerPortfolio = {
  broker: BrokerId;
  state: 'ok' | 'not_connected' | 'error';
  message?: string;
  connection: BrokerConnection | null;
  // True when connecting is impossible until the server is set up (migration or encryption key).
  setupRequired?: boolean;
  livePrices: boolean;
  fetchedAt: string | null;
  holdings: BrokerHolding[];
};

/** One load of every connected account. Values throughout are INR. */
export type LivePortfolioData = {
  brokers: BrokerPortfolio[];
};

export type PortfolioSuggestion = {
  kind: 'risk' | 'opportunity' | 'action';
  title: string;
  detail: string;
};

export type PortfolioAdvice = {
  summary: string;
  suggestions: PortfolioSuggestion[];
  caveats: string[];
};
