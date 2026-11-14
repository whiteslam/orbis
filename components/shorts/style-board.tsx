'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clapperboard, Clock, Info, X } from 'lucide-react';
import { estimateMakeTime, estimatesBySlug, type MakeEstimate } from '@/lib/shorts/estimate';
import type { ShortJob } from '@/lib/shorts/types';
import type { StyleCard } from '@/lib/shorts/view';

function Sheet({ style, large = false }: Readonly<{ style: StyleCard; large?: boolean }>) {
  if (!style.sheetUrl) return <div className={`sh-sheet is-empty${large ? ' is-large' : ''}`}><Clapperboard size={28} aria-hidden="true" /></div>;
  // Signed storage URLs: next/image would need the bucket host configured, for an hour-long link.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`sh-sheet${large ? ' is-large' : ''}`} src={style.sheetUrl} alt={`${style.name} style sheet`} loading="lazy" decoding="async" />;
}

const length = (style: StyleCard) => `${style.secondsMin}–${style.secondsMax} s`;

/**
 * Every style the installed skill has, as cards to pick from. The card picks
 * the style; its "i" button, a sibling of the card's button, opens the details
 * without picking.
 */
export function StyleBoard({ styles, jobs, onPick }: Readonly<{ styles: StyleCard[]; jobs: readonly ShortJob[]; onPick: (slug: string) => void }>) {
  const estimates = useMemo(() => estimatesBySlug(styles, jobs), [styles, jobs]);
  const [info, setInfo] = useState<string | null>(null);
  const infoButtons = useRef(new Map<string, HTMLButtonElement>());

  if (!styles.length) {
    return <p className="sh-empty">The styles appear here once your Shorts PC has started the worker once.</p>;
  }
  const open = info ? styles.find((style) => style.slug === info) : undefined;

  function closeInfo() {
    const slug = info;
    setInfo(null);
    // The dialog gives focus back on its own in most browsers; this covers the rest.
    if (slug) infoButtons.current.get(slug)?.focus();
  }

  return (
    <>
      <ul className="sh-board" aria-label="Styles">
        {styles.map((style) => (
          <li key={style.slug} className="sh-style">
            <button type="button" className="sh-style-pick" onClick={() => onPick(style.slug)}>
              <Sheet style={style} />
              <span className="sh-style-body">
                <span className="sh-style-name">
                  {style.name}
                  <span className={`sh-badge${style.is3d ? ' is-3d' : ''}`}>{style.is3d ? '3D' : '2D'}</span>
                </span>
                <span className="sh-style-for">{style.bestFor}</span>
                <span className="sh-style-meta">
                  <span className="sh-style-len">{length(style)}</span>
                  <MakeTime estimate={estimates[style.slug]} />
                </span>
              </span>
            </button>
            <button
              type="button"
              className="sh-style-info"
              aria-label={`About ${style.name}`}
              aria-haspopup="dialog"
              ref={(node) => { if (node) infoButtons.current.set(style.slug, node); else infoButtons.current.delete(style.slug); }}
              onClick={() => setInfo(style.slug)}
            >
              <Info size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <StyleInfo
          key={open.slug}
          style={open}
          estimate={estimates[open.slug]}
          onPick={() => onPick(open.slug)}
          onClose={closeInfo}
        />
      )}
    </>
  );
}

function MakeTime({ estimate }: Readonly<{ estimate: MakeEstimate }>) {
  return (
    <span className={`sh-style-time${estimate.measured ? ' is-measured' : ''}`} title={estimate.detail}>
      <Clock size={13} aria-hidden="true" />
      {estimate.label}
    </span>
  );
}

/** A style's details over the board, without picking it: a native modal <dialog>, so Esc closes it. */
function StyleInfo({ style, estimate, onPick, onClose }: Readonly<{ style: StyleCard; estimate: MakeEstimate; onPick: () => void; onClose: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = `sh-style-info-${style.slug}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="sh-style-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself: close, as Esc does.
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
    >
      <div className="sh-style-dialog-head">
        <h2 id={titleId} className="sh-h">
          {style.name}
          <span className={`sh-badge${style.is3d ? ' is-3d' : ''}`}>{style.is3d ? '3D' : '2D'}</span>
        </h2>
        <button type="button" className="sh-style-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <StyleDetail style={style} estimate={estimate} compact />
      <div className="sh-actions">
        <button type="button" className="so-action primary" onClick={() => { dialogRef.current?.close(); onPick(); }}>
          <span>Use this style</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button type="button" className="fd-link" onClick={() => dialogRef.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

/** One style up close: the whole sheet, what it's for and how long it takes to make. */
export function StyleDetail({ style, jobs = [], estimate, compact = false }: Readonly<{
  style: StyleCard;
  /** The person's shorts, for the time estimate when `estimate` isn't given. */
  jobs?: readonly ShortJob[];
  estimate?: MakeEstimate;
  /** Inside the info dialog: a shorter sheet. */
  compact?: boolean;
}>) {
  const time = estimate ?? estimateMakeTime(style, jobs);
  return (
    <section className={`sh-detail${compact ? ' is-compact' : ''}`} aria-label={`${style.name} style`}>
      <Sheet style={style} large />
      <div className="sh-detail-text">
        <p className="sh-detail-tag">{style.tagline}</p>
        <dl className="sh-facts">
          <div><dt>Best for</dt><dd>{style.bestFor}</dd></div>
          <div><dt>Length</dt><dd>{length(style)}, 9:16</dd></div>
          <div><dt>Look</dt><dd>{style.is3d ? 'Real 3D, rendered on your Shorts PC (slower without a graphics card)' : 'Flat 2D, quick to render'}</dd></div>
          <div><dt>Time</dt><dd>{time.detail}</dd></div>
          {style.exampleTitle && <div><dt>Example</dt><dd>{style.exampleTitle}</dd></div>}
        </dl>
      </div>
    </section>
  );
}
