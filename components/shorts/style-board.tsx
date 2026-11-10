'use client';

import { Clapperboard } from 'lucide-react';
import type { StyleCard } from '@/lib/shorts/view';

function Sheet({ style, large = false }: Readonly<{ style: StyleCard; large?: boolean }>) {
  if (!style.sheetUrl) return <div className={`sh-sheet is-empty${large ? ' is-large' : ''}`}><Clapperboard size={28} aria-hidden="true" /></div>;
  // Signed storage URLs: next/image would need the bucket host configured, for an hour-long link.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`sh-sheet${large ? ' is-large' : ''}`} src={style.sheetUrl} alt={`${style.name} style sheet`} loading="lazy" decoding="async" />;
}

const length = (style: StyleCard) => `${style.secondsMin}–${style.secondsMax} s`;

/** Every style the installed skill has, as cards to pick from. */
export function StyleBoard({ styles, onPick }: Readonly<{ styles: StyleCard[]; onPick: (slug: string) => void }>) {
  if (!styles.length) {
    return <p className="sh-empty">The styles appear here once your PC worker has started once.</p>;
  }
  return (
    <ul className="sh-board" aria-label="Styles">
      {styles.map((style) => (
        <li key={style.slug}>
          <button type="button" className="sh-style" onClick={() => onPick(style.slug)}>
            <Sheet style={style} />
            <span className="sh-style-body">
              <span className="sh-style-name">
                {style.name}
                <span className={`sh-badge${style.is3d ? ' is-3d' : ''}`}>{style.is3d ? '3D' : '2D'}</span>
              </span>
              <span className="sh-style-for">{style.bestFor}</span>
              <span className="sh-style-len">{length(style)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One style up close: the whole sheet and what it's for. */
export function StyleDetail({ style }: Readonly<{ style: StyleCard }>) {
  return (
    <section className="sh-detail" aria-label={`${style.name} style`}>
      <Sheet style={style} large />
      <div className="sh-detail-text">
        <p className="sh-detail-tag">{style.tagline}</p>
        <dl className="sh-facts">
          <div><dt>Best for</dt><dd>{style.bestFor}</dd></div>
          <div><dt>Length</dt><dd>{length(style)}, 9:16</dd></div>
          <div><dt>Look</dt><dd>{style.is3d ? 'Real 3D, rendered on your PC (slower without a graphics card)' : 'Flat 2D, quick to render'}</dd></div>
          {style.exampleTitle && <div><dt>Example</dt><dd>{style.exampleTitle}</dd></div>}
        </dl>
      </div>
    </section>
  );
}
