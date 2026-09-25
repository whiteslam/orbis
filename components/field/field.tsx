'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import type { Focus, FocusTarget, QuietRow } from '@/lib/focus/types';
import { BriefArt } from '@/components/field/brief-art';

/** Screen title with today's date above it, or a caller-supplied line instead. */
export function FieldHead({ title, subtitle }: { title: string; subtitle?: string }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  return (
    <header className="fd-head">
      <p className="fd-date" suppressHydrationWarning>{subtitle ?? today}</p>
      <h1>{title}</h1>
    </header>
  );
}

/**
 * The statement a screen opens with: a headline, a sentence, and — where the
 * screen has one — the control that acts on it. No container, no caption; the
 * ground carries it.
 */
export function FocusSurface({ focus, onAction, children }: { focus: Focus; onAction?: (target: FocusTarget) => void; children?: ReactNode }) {
  const action = focus.action;
  return (
    <section className="fd-focus" aria-labelledby={`focus-${focus.id}`}>
      {/* Wording can depend on the time of day, which may differ between server and browser render. */}
      <h2 id={`focus-${focus.id}`} suppressHydrationWarning>{focus.headline}</h2>
      <p suppressHydrationWarning>{focus.body}</p>
      {((action && onAction) || children) && (
        <div className="fd-act">
          {action && onAction
            ? <button type="button" onClick={() => onAction(action.target)}>{action.label}</button>
            : children}
        </div>
      )}
    </section>
  );
}

/** State, not calls to action: label left, value right, hairline between. */
export function QuietList({ heading, rows, onOpen }: { heading: string; rows: QuietRow[]; onOpen?: (target: FocusTarget) => void }) {
  return (
    <section className="fd-quiet">
      <h2>{heading}</h2>
      {rows.map((row) => {
        const body = (
          <>
            <span>{row.label}</span>
            <b className={row.empty ? 'empty' : undefined}>{row.value}</b>
          </>
        );
        return row.target && onOpen
          ? <button className="fd-line" type="button" key={row.label} onClick={() => onOpen(row.target!)}>{body}</button>
          : <div className="fd-line" key={row.label}>{body}</div>;
      })}
    </section>
  );
}

/**
 * The one number a screen is about, set on the ground at display size.
 *
 * Every tab used to open on a card whose heading restated what the card below
 * already showed. Atlas replaces that with a single figure, the sentence that
 * qualifies it, and — where the data supports one — a delta. No container: the
 * ground carries it, as it carries the brief.
 */
export function FieldHero({ value, label, delta }: { value: string; label: string; delta?: { text: string; tone: 'up' | 'down' | 'flat' } | null }) {
  return (
    <div className="fd-hero">
      <p className="fd-hero-value">{value}</p>
      <div className="fd-hero-meta">
        <span>{label}</span>
        {delta && (
          <span className={`fd-delta ${delta.tone}`}>
            {delta.tone === 'up' && <ArrowUp size={10} strokeWidth={2.8} aria-hidden="true" />}
            {delta.tone === 'down' && <ArrowDown size={10} strokeWidth={2.8} aria-hidden="true" />}
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small uppercase label that separates sections without drawing a box. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="fd-label">{children}</p>;
}

/**
 * The Home brief, as a deck.
 *
 * One statement per slide over its own illustrated scene, swiped sideways. Two
 * things make it Atlas rather than a plain carousel. Behind the top card sit the
 * edges of the cards still to come, so the depth of the brief is visible before
 * anything is swiped. And the dots move inside the card as a segmented rail at
 * the top — each segment is a real button, so the rail both reports position and
 * jumps to a slide.
 *
 * Every slide also prints where its claim came from. A statement about someone's
 * money or body that cannot say which source produced it is the thing this brief
 * most needs to avoid, so `source` is rendered whenever the composer sets it.
 */
export function FocusSlides({ slides, onAction, night = false }: { slides: Focus[]; onAction: (target: FocusTarget) => void; night?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const key = slides.map((slide) => slide.id).join('|');

  // A finished task drops out of the brief. When that happens the carousel must
  // not keep showing a gap where it was, so it returns to the first slide.
  useEffect(() => {
    setActive(0);
    track.current?.scrollTo({ left: 0 });
  }, [key]);

  // The scroll position is the source of truth, so swiping and the dots agree.
  function onScroll() {
    const node = track.current;
    if (!node) return;
    const index = Math.round(node.scrollLeft / Math.max(node.clientWidth, 1));
    setActive(Math.max(0, Math.min(index, slides.length - 1)));
  }

  function go(index: number) {
    const node = track.current;
    if (!node) return;
    node.scrollTo({ left: index * node.clientWidth, behavior: 'smooth' });
    setActive(index);
  }

  const many = slides.length > 1;

  return (
    <div className="fd-brief">
      <div className={`fd-deck ${many ? 'stacked' : ''}`}>
        {/* The cards still to come, showing only their top edge. */}
        {many && <><span className="fd-deck-edge far" aria-hidden="true" /><span className="fd-deck-edge near" aria-hidden="true" /></>}

        <div className="fd-track" ref={track} onScroll={onScroll}>
          {slides.map((slide, index) => (
            <section className="fd-slide fd-focus" key={slide.id} aria-labelledby={`brief-${slide.id}`}>
              <BriefArt art={slide.art ?? 'calm'} night={night} />
              <div className="fd-slide-body">
                <p className="fd-slide-kicker">Orbis brief{many ? ` · ${index + 1} of ${slides.length}` : ''}</p>
                {/* Wording can depend on the time of day, which may differ between server and browser render. */}
                <h2 id={`brief-${slide.id}`} suppressHydrationWarning>{slide.headline}</h2>
                <p suppressHydrationWarning>{slide.body}</p>
                {slide.action && (
                  <div className="fd-act">
                    <button type="button" onClick={() => onAction(slide.action!.target)}>{slide.action.label}</button>
                  </div>
                )}
                {slide.source && (
                  <p className="fd-slide-src" suppressHydrationWarning>
                    <Sparkles size={11} strokeWidth={2} aria-hidden="true" />
                    {slide.source}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>

        {many && (
          <div className="fd-rail" role="tablist" aria-label="Brief">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                className="fd-rail-seg"
                type="button"
                role="tab"
                aria-selected={index === active}
                aria-current={index === active}
                aria-label={slide.headline}
                onClick={() => go(index)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
