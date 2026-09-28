import type { SavedWorkbookAdvice } from '@/lib/ai/saved';
import type { WorkbookAdvice, WorkbookObservation } from '@/lib/workbook/types';

/** What went into a request made in this session. Saved advice does not record it, so it is null then. */
export type AdviceSent = { steps: boolean; notes: boolean; profile: boolean; persona: boolean };

// What is on screen: either advice just generated, or advice restored from an earlier session.
// The cited observations travel with it, because the workbook itself is never stored.
export type ShownAdvice = {
  advice: WorkbookAdvice;
  observations: WorkbookObservation[];
  title: string | null;
  savedAt: string | null;
  savedId: string | null;
  sent: AdviceSent | null;
};

export function adviceFromSaved(saved: SavedWorkbookAdvice | null): ShownAdvice | null {
  if (!saved) return null;
  return {
    advice: saved.result,
    observations: saved.context?.observations ?? [],
    title: saved.title,
    savedAt: saved.createdAt,
    savedId: saved.id,
    sent: null,
  };
}

export function savedWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Splits the model's summary into a headline sentence and whatever follows it. */
export function splitSummary(summary: string) {
  const match = summary.match(/^([\s\S]+?[.!?])\s+([\s\S]*)$/);
  if (!match || match[1].length > 120) return { headline: summary, rest: '' };
  return { headline: match[1], rest: match[2].trim() };
}
