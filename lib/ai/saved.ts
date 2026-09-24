import type { PortfolioAdvice } from '@/lib/invest/types';
import type { WorkbookAdvice, WorkbookObservation } from '@/lib/workbook/types';

export type AiFeature = 'workbook_advice' | 'portfolio_advice';

/** Identifies a freshly saved result so the page can delete it without a reload. */
export type AiResultStamp = { id: string; createdAt: string };

/** A generated result read back from the database, shaped for rendering. */
export type SavedAiResult<TResult, TContext = Record<string, unknown>> = {
  id: string;
  title: string | null;
  context: TContext;
  result: TResult;
  createdAt: string;
};

// The workbook is not stored, so the observations the advice cites are saved with it.
export type SavedWorkbookAdvice = SavedAiResult<WorkbookAdvice, { observations?: WorkbookObservation[] }>;
export type SavedPortfolioAdvice = SavedAiResult<PortfolioAdvice>;
