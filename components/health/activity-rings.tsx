// Concentric progress rings in the style of Apple's Activity rings. Values are fractions of a goal;
// anything past 1 shows as a closed ring.

export type Ring = { label: string; value: number; color: string; track: string };

const STROKE = 14;
const GAP = 3;

export function ActivityRings({ rings, size = 132 }: { rings: Ring[]; size?: number }) {
  const center = size / 2;
  return (
    <svg className="activity-rings" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={rings.map((ring) => `${ring.label} ${Math.round(ring.value * 100)}%`).join(', ')}>
      {rings.map((ring, index) => {
        const radius = center - STROKE / 2 - index * (STROKE + GAP);
        const circumference = 2 * Math.PI * radius;
        const progress = Math.min(Math.max(ring.value, 0), 1);
        return (
          <g key={ring.label} transform={`rotate(-90 ${center} ${center})`}>
            <circle cx={center} cy={center} r={radius} fill="none" stroke={ring.track} strokeWidth={STROKE} />
            {progress > 0 && (
              <circle
                className="activity-ring-progress"
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${progress * circumference} ${circumference}`}
                style={{ '--ring-length': `${circumference}` } as React.CSSProperties}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
