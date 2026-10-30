import type { CSSProperties } from 'react';

export type OrbisAiPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

// Ask Orbis's mark: the Orbis ring (the same conic gradient and 45% hole as
// OrbisMark) with a moon on its orbit and three points in the hole that show
// what the assistant is doing. Every layer is a span the stylesheet animates
// (app/styles/orbis-ai.css); with Reduce Motion each phase is a still pose.
export function OrbisAiMark({ size = 28, phase = 'idle', className }: Readonly<{ size?: number; phase?: OrbisAiPhase; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={['oai', className].filter(Boolean).join(' ')}
      data-phase={phase}
      style={{ '--oai-size': `${size}px` } as CSSProperties}
    >
      <span className="oai-halo" />
      <span className="oai-ripple" />
      <span className="oai-ripple" />
      <span className="oai-ring" />
      <span className="oai-orbit">
        <span className="oai-trail" />
        <span className="oai-moon" />
      </span>
      <span className="oai-core">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
