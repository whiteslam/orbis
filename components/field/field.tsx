'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, CloudSun, Footprints, HeartPulse, Mail, Orbit, TrendingUp, X, type LucideIcon } from 'lucide-react';
import type { Focus, FocusTarget, QuietRow, SourceId } from '@/lib/focus/types';
import type { HomeNote } from '@/lib/home/note';

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
 * The mark printed beside a card's source line, so where a number came from is
 * readable at a glance and not only in the wording.
 *
 * These are plain glyphs standing for the kind of service. Orbis ships one real
 * brand file (Groww) and does not reproduce anyone else's logo here.
 */
const SOURCE_MARK: Record<SourceId, { icon: LucideIcon; label: string }> = {
  'open-meteo': { icon: CloudSun, label: 'Open-Meteo' },
  gmail: { icon: Mail, label: 'Gmail' },
  'apple-health': { icon: HeartPulse, label: 'Apple Health' },
  groww: { icon: TrendingUp, label: 'Groww' },
  orbis: { icon: Orbit, label: 'Orbis' },
};

/**
 * The Home brief, as a short note in Orbis's own voice.
 *
 * This replaced a swipeable deck of tinted cards — icon, headline, chip row of
 * measurements, button, source footer, four of them abreast. Every true thing
 * had to be cut to fit that box, and a reading of your morning came out looking
 * like a dashboard. Sentences carry the same facts and read as written.
 *
 * It sits on the ground with no fill, no border and no shadow, like every other
 * statement in this layout.
 */
export function FocusNote({ note }: { note: HomeNote }) {
  return (
    <section className="fd-note-brief" aria-label="Your brief">
      {/* The greeting and the day both depend on the hour, which can differ
          between the server render and the browser's. */}
      <p className="fd-note-greet" suppressHydrationWarning>
        {note.greeting}
        <time className="fd-note-time" suppressHydrationWarning>{note.time}</time>
      </p>
      <p className="fd-note-line" suppressHydrationWarning>{note.caption}</p>
      {note.sources.length > 0 && (
        <p className="fd-note-from">
          {note.sources.map((id) => {
            const mark = SOURCE_MARK[id];
            const MarkIcon = mark.icon;
            return <span key={id}><MarkIcon size={11} strokeWidth={2} aria-hidden="true" />{mark.label}</span>;
          })}
        </p>
      )}
    </section>
  );
}
