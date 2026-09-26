// The hairline rows under the Home brief: state, never calls to action.
//
// The brief itself moved to lib/home/note.ts when the card deck became a note;
// this file kept only the rows, which were never cards to begin with.
import type { FinanceSummary } from '@/lib/finance/types';
import type { StepsSummary } from '@/lib/health/types';
import type { QuietRow } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count, money, whole } from './types.ts';

export type QuietInput = {
  finance: FinanceSummary;
  steps: StepsSummary;
  /** How many health documents are saved. */
  documentCount: number;
};

/** The hairline rows under the brief: state, never calls to action. */
export function composeQuietRows({ finance, steps, documentCount }: QuietInput): QuietRow[] {
  const spend = finance.monthlyExpenses.length === 1 ? finance.monthlyExpenses[0] : null;
  const expenses = spend
    ? money(spend.amount, spend.currency)
    : finance.monthlyExpenses.length > 1
      ? 'Several currencies'
      : 'No data';
  const stepsValue = steps.average7 !== null ? `${whole(steps.average7)} a day` : 'Not imported';

  return [
    { label: 'Spending this month', value: expenses, empty: !spend && finance.monthlyExpenses.length === 0, target: 'finance' },
    { label: 'Alerts to confirm', value: String(finance.pendingCandidateCount), empty: finance.pendingCandidateCount === 0, target: 'finance' },
    { label: 'Steps, 7-day average', value: stepsValue, empty: steps.average7 === null, target: 'health' },
    { label: 'Health documents', value: documentCount ? count(documentCount, 'file') : 'None yet', empty: documentCount === 0, target: 'health' },
  ];
}
