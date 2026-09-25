'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, CloudRain, FileText, Footprints, Link2, Mail, Snowflake, Sparkles, Sun, Target, TriangleAlert, WalletCards, X, type LucideIcon } from 'lucide-react';
import type { ArtScene, Focus, FocusTarget, QuietRow } from '@/lib/focus/types';

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
 * Returns a ref for any element inside a screen; the screen scrolls back to the
 * top whenever `key` changes. Tabs swap views in place (Expense → Add expense),
 * and a view that opens halfway down the page reads as a glitch.
 */
export function useScrollTop(key: unknown) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    anchor.current?.closest('.screen-body')?.scrollTo({ top: 0 });
  }, [key]);
  return anchor;
}

/**
 * The top of a view opened from a tab: where it sits (`crumb`), the title, and
 * one way out — back on the left, or close on the right for a form.
 */
export function FieldSubHead({ crumb, title, lead, onBack, onClose, backLabel }: { crumb: string; title?: string; lead?: ReactNode; onBack?: () => void; onClose?: () => void; backLabel?: string }) {
  return (
    <header className="fd-sub-head">
      <div className={onClose ? 'fd-crumb end' : 'fd-crumb'}>
        {onBack && <button className="fd-round" type="button" onClick={onBack} aria-label={backLabel ?? 'Back'}><ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" /></button>}
        <p>{crumb}</p>
        {onClose && <button className="fd-round" type="button" onClick={onClose} aria-label={backLabel ?? 'Close'}><X size={16} strokeWidth={2.2} aria-hidden="true" /></button>}
      </div>
      {title && <h1>{title}</h1>}
      {lead &&<p className="fd-lead">{lead}</p>}
    </header>
  );
}

/** A numbered step: ring, bold line, detail, and an optional footnote. */
export function FieldStep({ n, title, children, foot }: { n: number; title: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="fd-step">
      <i aria-hidden="true">{n}</i>
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
        {foot && <small>{foot}</small>}
      </div>
    </div>
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
 * Each scene's tint and icon. The tint says what a card is about before a word
 * is read: green for body and goals, amber for money, red for what needs you,
 * blue for weather, neutral for setup.
 */
type Tone = 'green' | 'amber' | 'red' | 'blue' | 'plain';
const TOPIC: Record<ArtScene, { tone: Tone; icon: LucideIcon }> = {
  rain: { tone: 'blue', icon: CloudRain },
  sun: { tone: 'amber', icon: Sun },
  cold: { tone: 'blue', icon: Snowflake },
  alerts: { tone: 'red', icon: Mail },
  money: { tone: 'amber', icon: WalletCards },
  'steps-up': { tone: 'green', icon: Footprints },
  'steps-down': { tone: 'green', icon: Footprints },
  goal: { tone: 'green', icon: Target },
  link: { tone: 'plain', icon: Link2 },
  document: { tone: 'plain', icon: FileText },
  saved: { tone: 'blue', icon: Sparkles },
  broken: { tone: 'red', icon: TriangleAlert },
  calm: { tone: 'green', icon: Sun },
};

/**
 * The Home brief: a row of tinted cards, swiped sideways.
 *
 * Each card is tinted by what it is about and carries an icon, the claim, the
 * sentence behind it, one action and its source. The next card peeks in from
 * the right, so the swipe explains itself; the dots underneath both report
 * position and jump to a card.
 *
 * It replaced an illustrated dark deck whose scenes drew the same rising line
 * for any "steps up" slide — decoration that read as data — under a heavy scrim.
 */
export function FocusSlides({ slides, onAction }: { slides: Focus[]; onAction: (target: FocusTarget) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const key = slides.map((slide) => slide.id).join('|');

  // A finished task drops out of the brief. When that happens the row must
  // not keep showing a gap where it was, so it returns to the first card.
  useEffect(() => {
    setActive(0);
    track.current?.scrollTo({ left: 0 });
  }, [key]);

  // Cards are narrower than the track, so position is measured against a card.
  function cardWidth() {
    const node = track.current;
    const first = node?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + 10 : Math.max(node?.clientWidth ?? 1, 1);
  }

  // The scroll position is the source of truth, so swiping and the dots agree.
  function onScroll() {
    const node = track.current;
    if (!node) return;
    const index = Math.round(node.scrollLeft / cardWidth());
    setActive(Math.max(0, Math.min(index, slides.length - 1)));
  }

  function go(index: number) {
    track.current?.scrollTo({ left: index * cardWidth(), behavior: 'smooth' });
    setActive(index);
  }

  const many = slides.length > 1;

  return (
    <div className="fd-brief">
      <div className={many ? 'fd-track many' : 'fd-track'} ref={track} onScroll={onScroll}>
        {slides.map((slide, index) => {
          const topic = TOPIC[slide.art ?? 'calm'];
          const Icon = topic.icon;
          return (
            <section className={`fd-card tone-${topic.tone}`} key={slide.id} aria-labelledby={`brief-${slide.id}`} aria-roledescription="card" inert={many && index !== active ? true : undefined}>
              <i className="fd-card-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></i>
              {/* Wording can depend on the time of day, which may differ between server and browser render. */}
              <h2 id={`brief-${slide.id}`} suppressHydrationWarning>{slide.headline}</h2>
              <p suppressHydrationWarning>{slide.body}</p>
              {(slide.action || slide.source) && (
                <div className="fd-card-foot">
                  {slide.action && <button type="button" onClick={() => onAction(slide.action!.target)}>{slide.action.label}</button>}
                  {slide.source && <p className="fd-card-src" suppressHydrationWarning>{slide.source}</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {many && (
        <div className="fd-dots" role="tablist" aria-label="Brief">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`${index + 1} of ${slides.length}: ${slide.headline}`}
              onClick={() => go(index)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
