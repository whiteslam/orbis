export type FinanceTransactionSummary = {
  id: string;
  amount: number;
  currency: string;
  direction: 'expense' | 'income';
  merchant: string | null;
  category: string | null;
  occurredAt: string;
  source: 'gmail' | 'manual';
  paymentMethod: string | null;
  note: string | null;
};

export type FinanceSummary = {
  databaseReady: boolean;
  loadError: boolean;
  transactions: FinanceTransactionSummary[];
  monthlyExpenses: Array<{ currency: string; amount: number }>;
  month: null | {
    currency: string;
    year: number;
    month: number;
    spent: number;
    received: number;
    categories: Array<{ category: string; amount: number }>;
    daily: Array<{ day: number; amount: number }>;
  };
};
