export type FinanceTransactionSummary = {
  id: string;
  amount: number;
  currency: string;
  direction: 'expense' | 'income';
  merchant: string | null;
  category: string | null;
  occurredAt: string;
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
};
