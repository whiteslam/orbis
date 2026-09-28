'use client';

import type { ReactNode } from 'react';
import { FieldSubHead } from '@/components/field/field';

/**
 * What Orbis shows when a screen fails to render: a calm sentence, a way to try
 * again and a way home. Never the error itself; that stays in the server log
 * (the digest ties the two together).
 */
export function BoundaryScreen({ onRetry, home }: { onRetry: () => void; home: ReactNode }) {
  return (
    <main className="screen-body field fd-boundary">
      <FieldSubHead crumb="Orbis" title="Something went wrong" lead="This part of Orbis didn’t load. Your data is safe. Try again, or go back to Home." />
      <div className="fd-act">
        <button className="fd-button" type="button" onClick={onRetry}>Try again</button>
        {home}
      </div>
    </main>
  );
}
