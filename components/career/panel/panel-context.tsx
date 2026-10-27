'use client';

import { createContext, useContext } from 'react';
import type { SheetContext } from '@/components/career/application-sheet';
import type { MoveServices } from '@/components/career/panel/use-moves';
import type { CareerJob } from '@/lib/career/types';
import type { ApplicationCard, ApplicationDetail, CareerHome } from '@/lib/career/view';

export type PanelApi = {
  home: CareerHome | null;
  sheet: SheetContext;
  services: MoveServices;
  /** Opens the right-hand drawer on a job (and its application, when there is one). */
  openJob: (job: CareerJob, card?: ApplicationCard | null) => void;
  openJobId: (jobId: string) => void;
  /** Re-reads the home after anything changed. */
  reload: () => void;
  /** A line in the panel's status toast. */
  say: (text: string, ok: boolean) => void;
};

const PanelContext = createContext<PanelApi | null>(null);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelApi {
  const api = useContext(PanelContext);
  if (!api) throw new Error('usePanel outside the Career panel');
  return api;
}

/** What the drawer can show at once for a card, before its detail loads. */
export function fallbackDetail(job: CareerJob, card: ApplicationCard | null, home: CareerHome | null): ApplicationDetail {
  const events = card ? (home?.recent ?? []).filter((event) => event.applicationId === card.application.id) : [];
  return { job, application: card?.application ?? null, events, offer: null, files: { pdf: null, docx: null }, pasteKit: [] };
}
