'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { loadShortsHealthAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { HealthLine } from '@/lib/shorts/health';

/** Read again this often while the tab is open: the shelf and the PC change slowly. */
const REFRESH_MS = 60_000;

/**
 * Social → Shorts: whether the chain from the PC to the channel is working, in five
 * lines (lib/shorts/health.ts). Amber and red lines are the ones to look at.
 */
export function HealthCard() {
  const [lines, setLines] = useState<HealthLine[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const result = await safeAction(loadShortsHealthAction)();
      if (!live) return;
      if (result.success) {
        setLines(result.data);
        setProblem(null);
      } else setProblem(result.message);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  if (!lines) {
    return problem
      ? <p className="fd-msg bad">{problem}</p>
      : <p className="sh-loading"><LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> Checking…</p>;
  }

  return (
    <dl className="sh-health">
      {lines.map((line) => (
        <div key={line.key} className={line.tone === 'ok' ? 'sh-health-row' : `sh-health-row sh-health-${line.tone}`}>
          <dt>{line.label}</dt>
          <dd>{line.text}</dd>
        </div>
      ))}
    </dl>
  );
}
