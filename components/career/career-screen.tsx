'use client';

import { FieldHead } from '@/components/field/field';
import type { HeadsupAction } from '@/lib/headsups/types';

/**
 * The Career tab. A placeholder until the views land: For you, Queue, Tracker,
 * Insights and Setup (docs/superpowers/specs/2026-10-27-career-copilot-design.md).
 * `intent` carries a heads-up's `open_career_application`, read once on mount.
 */
export function CareerScreen({ intent }: Readonly<{ intent: HeadsupAction | null }>) {
  const applicationId = intent?.type === 'open_career_application' ? intent.applicationId : null;
  return (
    <div className="screen-body field cr-screen" data-application={applicationId ?? undefined}>
      <FieldHead title="Career" />
    </div>
  );
}
