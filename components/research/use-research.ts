'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadResearchDeskAction, loadResearchRunAction } from '@/app/research/actions';
import { safeAction } from '@/lib/client/safe-action';
import { ACTIVE_STATUSES, type ResearchEvent, type ResearchRun, type ResearchSettlement } from '@/lib/research/types';
import type { ResearchDesk } from '@/lib/research/view';

/** Often enough to feel live, rarely enough for a phone left open on a 10-minute run. */
const POLL_MS = 4_000;
const RETRY_MS = 15_000;

/**
 * One run, kept up to date: its row and its events, asking each time only for
 * the events after the last one it has. Polls while the run is queued or
 * running and stops when it ends.
 */
export function useResearchRun(runId: string) {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [settlement, setSettlement] = useState<ResearchSettlement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const result = await safeAction(loadResearchRunAction)(runId, lastSeq.current);
      if (!alive) return;
      if (!result.success) {
        setProblem(result.message);
        timer = setTimeout(tick, RETRY_MS);
        return;
      }
      setProblem(null);
      const fresh = result.data.events;
      if (fresh.length) {
        lastSeq.current = Math.max(lastSeq.current, ...fresh.map((event) => event.seq));
        setEvents((current) => [...current, ...fresh.filter((event) => !current.some((known) => known.seq === event.seq))]);
      }
      setRun(result.data.run);
      setSettlement(result.data.settlement);
      if (ACTIVE_STATUSES.includes(result.data.run.status)) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { run, events, settlement, problem, reload };
}

/** The desk itself: null while loading, `false` when it isn't for this account. */
export function useResearchDesk() {
  const [desk, setDesk] = useState<ResearchDesk | null | false>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    void safeAction(loadResearchDeskAction)().then((result) => {
      if (!result.success) return setProblem(result.message);
      setProblem(null);
      setDesk(result.data ?? false);
    });
  }, []);
  useEffect(load, [load]);
  return { desk, problem, reload: load, setDesk };
}
