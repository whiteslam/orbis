'use client';

import { useEffect, useState } from 'react';
import { QuietList } from '@/components/field/field';
import type { FocusTarget, QuietRow } from '@/lib/focus/types';

/**
 * The job hunt's one line on Home (lib/focus/career.ts). Asked for in the
 * background like the portfolio and mail; nothing shows until it lands, and
 * nothing at all for anyone who hasn't set Career up.
 */
export function CareerRow({ openTab }: Readonly<{ openTab: (target: FocusTarget) => void }>) {
  const [row, setRow] = useState<QuietRow | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/home/career', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<QuietRow | null>) : null))
      .then((result) => { if (live) setRow(result); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!row) return null;
  return <QuietList heading="Career" rows={[row]} onOpen={openTab} />;
}
