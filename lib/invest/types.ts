export type InvestmentHolding = {
  id: string;
  name: string;
  assetType: 'stock' | 'fund' | 'etf' | 'crypto' | 'cash' | 'other';
  quantity: number;
  valuePerUnit: number;
  currency: string;
  valueAsOf: string;
  marketSymbol: string | null;
  marketSource: MarketSource | null;
};

export type MarketSource = 'alpha_vantage' | 'coingecko' | 'amfi';

// A price from a live data provider. Alpha Vantage prices are in the holding's
// own currency; AMFI and CoinGecko prices are in INR.
export type LivePrice = {
  price: number;
  changePercent: number | null;
  asOf: string;
  source: 'groww' | MarketSource;
  stale: boolean;
};

export type InvestmentSummary = {
  databaseReady: boolean;
  loadError: boolean;
  holdings: InvestmentHolding[];
};

export type GrowwHolding = {
  symbol: string;
  isin: string | null;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  priceSource: LivePrice['source'] | null;
  priceAsOf: string | null;
  priceStale: boolean;
};

export type GrowwPortfolio = {
  state: 'ok' | 'not_connected' | 'error';
  message?: string;
  // How this account is linked: saved in Orbis by the user, or server env keys.
  connection: { source: 'account' | 'server'; status: 'connected' | 'reconnect_required'; lastSyncAt: string | null } | null;
  // True when connecting is impossible until the server is set up (migration or encryption key).
  setupRequired?: boolean;
  livePrices: boolean;
  fetchedAt: string | null;
  holdings: GrowwHolding[];
};

export type LivePortfolioData = {
  groww: GrowwPortfolio;
  manualPrices: Record<string, LivePrice>;
  fxToInr: Record<string, number> | null;
  fxDate: string | null;
  notices: string[];
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
