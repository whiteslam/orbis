'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadCareerAction } from '@/app/career/actions';
import { useRun } from '@/components/career/use-run';
import { CareerPanelView } from '@/components/career/panel/panel-view';
import type { CareerHome } from '@/lib/career/view';

/**
 * The full web panel at /active/career: Overview, Pipeline, Jobs, Interviews,
 * Offers, Insights and Setup (docs/superpowers/specs/2026-10-27-career-copilot-design.md,
 * "The web panel"). The page has already checked the session, the allowlist,
 * the lock and the PIN. The home loads once here, and again after anything
 * changes it; the last good home stays on screen while a reload runs.
 */
export function CareerPanel({ email }: Readonly<{ email: string | null }>) {
  const [home, setHome] = useState<CareerHome | null>(null);
  const { busy, notice, run } = useRun();
  const load = useCallback(() => {
    void run('load', () => loadCareerAction(), setHome);
  }, [run]);
  useEffect(() => load(), [load]);

  const who = home?.state.profile?.contact.name || email;
  return (
    <CareerPanelView
      home={home}
      who={who ?? null}
      problem={notice && !notice.ok ? notice.text : null}
      loading={busy === 'load' || (home === null && notice === null)}
      onReload={load}
      onHome={(update) => setHome((current) => (current ? update(current) : current))}
    />
  );
}
