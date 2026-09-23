export type InvestmentHolding = {
  id: string;
  name: string;
  assetType: 'stock' | 'fund' | 'etf' | 'crypto' | 'cash' | 'other';
  quantity: number;
  valuePerUnit: number;
  currency: string;
  valueAsOf: string;
};

export type InvestmentSummary = {
  databaseReady: boolean;
  loadError: boolean;
  holdings: InvestmentHolding[];
};
