// The Orbis mark: a conic-gradient ring with a hole at 45% of its diameter.
// Two nested elements, never an SVG stroke, so it scales and themes from CSS.
export function OrbisMark({ size = 42, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['orbis-mark', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    >
      <span className="orbis-mark-hole" />
    </span>
  );
}
