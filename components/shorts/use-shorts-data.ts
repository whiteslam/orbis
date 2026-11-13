'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadShortsViewAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import { isActive } from '@/lib/shorts/rules';
import type { ShortJob } from '@/lib/shorts/types';
import type { ShortsView } from '@/lib/shorts/view';

const POLL_MS = 5000;

export type ShortsData = {
  view: ShortsView | null;
  problem: string | null;
  load: () => Promise<void>;
  upsert: (job: ShortJob) => void;
  drop: (id: string) => void;
  /** Stops the list refresh while one short's own page polls its events. */
  setPaused: (paused: boolean) => void;
};

/**
 * The Shorts list, worker and covers, loaded once for the whole Social
 * screen: the Studio's live column and the Shorts tab read the same copy.
 * While a short is being made it refreshes every few seconds.
 */
export function useShortsData(): ShortsData {
  const [view, setView] = useState<ShortsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    const result = await safeAction(loadShortsViewAction)();
    if (result.success) { setView(result.data); setProblem(null); }
    else setProblem(result.message);
  }, []);

  // Loads after the screen is up, so the Posts tab never waits on it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const busy = view?.jobs.some(isActive) ?? false;
  useEffect(() => {
    if (!busy || paused) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, paused, load]);

  const upsert = useCallback((job: ShortJob) => setView((current) => current && ({ ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] })), []);
  const drop = useCallback((id: string) => setView((current) => current && ({ ...current, jobs: current.jobs.filter((item) => item.id !== id) })), []);

  return { view, problem, load, upsert, drop, setPaused };
}
