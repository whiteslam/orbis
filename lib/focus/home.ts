// The hairline rows under the Home brief: state, never calls to action.
//
// The brief itself moved to lib/home/note.ts when the card deck became a note;
// this file kept only the rows, which were never cards to begin with.
import type { FinanceSummary } from '@/lib/finance/types';
import type { StepsSummary } from '@/lib/health/types';
import type { QuietRow } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count } from './types.ts';

export type QuietInput = {
  finance: FinanceSummary;
  steps: StepsSummary;
  /** How many health documents are saved. */
  documentCount: number;
};

/**
 * The hairline rows under the brief: state, never calls to action.
 *
 * Only what no card above already shows. Spending this month and the 7-day
 * step average used to be rows here as well as tiles in TodayWidgets, so Home
 * printed both numbers twice; the tiles keep them.
 */
export function composeQuietRows({ documentCount }: QuietInput): QuietRow[] {
  return [
    { label: 'Health documents', value: documentCount ? count(documentCount, 'file') : 'None yet', empty: documentCount === 0, target: 'health' },
  ];
}
