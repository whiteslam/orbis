import { scoreBand } from '@/components/career/format';

const SIZES = { sm: 40, md: 52, lg: 76 } as const;
const STROKE = { sm: 3.5, md: 4, lg: 5 } as const;
const DASH = 3;
const GAP = 2.5;

/** The arc as a dash pattern: one stroke up to the score, or short dashes when the score is rough. */
function arcPattern(length: number, circumference: number, rough: boolean) {
  if (!rough) return `${length} ${circumference}`;
  const dashes = Math.max(1, Math.floor(length / (DASH + GAP)));
  return `${Array.from({ length: dashes }, () => `${DASH} ${GAP}`).join(' ')} 0 ${circumference}`;
}

/**
 * A match score, 0–100, as a ring with the number in it.
 *
 * The arc's colour follows the band (strong, good, partial, weak), and the
 * owner's threshold is a small notch on the track, so "above your bar" reads
 * at a glance. Neither carries meaning alone: the number is printed, and the
 * band's word is in the accessible name (and shown with `showWord`). A
 * low-confidence score (a thin job) draws a dashed arc and says so.
 */
export function ScoreRing({ score, size = 'md', threshold = null, lowConfidence = false, showWord = false }: Readonly<{
  score: number | null;
  size?: keyof typeof SIZES;
  /** The owner's bar (30–90), marked on the track. */
  threshold?: number | null;
  /** A thin job: scored on a title and a line. */
  lowConfidence?: boolean;
  /** Print the band's word under the ring (the sheet does; cards don't). */
  showWord?: boolean;
}>) {
  const { band, word } = scoreBand(score);
  const box = SIZES[size];
  const stroke = STROKE[size];
  const radius = (box - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, score ?? 0));
  const centre = box / 2;
  const rough = lowConfidence ? ', a rough score from a short listing' : '';
  const bar = threshold ? `. Your bar is ${threshold}` : '';
  const label = score === null ? 'Not scored yet' : `Match ${Math.round(value)} out of 100, ${word.toLowerCase()}${rough}${bar}`;

  // The notch crosses the track at the threshold, measured clockwise from the top.
  const angle = ((threshold ?? 0) / 100) * 2 * Math.PI - Math.PI / 2;
  const inner = radius - stroke * 0.9;
  const outer = radius + stroke * 0.9;

  return (
    <span className={`cr-ring cr-ring-${size} cr-band-${band}`} role="img" aria-label={label}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <circle className="cr-ring-track" cx={centre} cy={centre} r={radius} strokeWidth={stroke} />
        {score !== null && value > 0 && (
          <circle
            className={lowConfidence ? 'cr-ring-arc rough' : 'cr-ring-arc'}
            cx={centre}
            cy={centre}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={arcPattern((value / 100) * circumference, circumference, lowConfidence)}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        )}
        {threshold ? (
          <line
            className="cr-ring-bar"
            x1={centre + inner * Math.cos(angle)}
            y1={centre + inner * Math.sin(angle)}
            x2={centre + outer * Math.cos(angle)}
            y2={centre + outer * Math.sin(angle)}
          />
        ) : null}
      </svg>
      <b aria-hidden="true">{score === null ? '–' : Math.round(value)}</b>
      {showWord && <small aria-hidden="true">{lowConfidence ? `${word}, rough` : word}</small>}
    </span>
  );
}
