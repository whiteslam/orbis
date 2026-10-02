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

/** An expected income stream: a salary, a retainer, anything that recurs. */
export type IncomePlanEntry = {
  id: string;
  label: string;
  amount: number;
  currency: string;
  /** Day of the month it usually arrives. */
  payDay: number;
  /** The income category that counts as this stream arriving. */
  category: string;
  active: boolean;
};

export type FinanceSummary = {
  databaseReady: boolean;
  loadError: boolean;
  transactions: FinanceTransactionSummary[];
  monthlyExpenses: Array<{ currency: string; amount: number }>;
  /** What you expect to earn. Empty until it is set up. */
  incomePlan: IncomePlanEntry[];
  incomePlanReady: boolean;
  /** Investments you recorded yourself (FD, RD, SIP…), all time, by category. */
  ownInvestments: OwnInvestments;
  month: null | {
    currency: string;
    year: number;
    month: number;
    spent: number;
    received: number;
    /** Moved into investments this month; not part of spent. */
    invested: number;
    categories: Array<{ category: string; amount: number }>;
    /** Income by source: Salary, Freelance, Refund and so on. */
    incomeCategories: Array<{ category: string; amount: number }>;
    daily: Array<{ day: number; amount: number }>;
  };
};

export type OwnInvestments = {
  currency: string;
  total: number;
  categories: Array<{ category: string; amount: number; count: number; lastAt: string }>;
};
