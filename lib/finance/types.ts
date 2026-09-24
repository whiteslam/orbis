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

export type FinanceCandidateSummary = {
  id: string;
  receivedAt: string;
  parseStatus: 'needs_review' | 'unrecognized';
  amount: number | null;
  currency: string | null;
  direction: 'expense' | 'income' | null;
  merchant: string | null;
  reason: string | null;
};

export type FinanceSummary = {
  databaseReady: boolean;
  loadError: boolean;
  connection: null | { email: string; status: 'connected' | 'reconnect_required'; lastSyncAt: string | null };
  pendingCandidateCount: number;
  unparsedCandidateCount: number;
  reviewCandidates: FinanceCandidateSummary[];
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
