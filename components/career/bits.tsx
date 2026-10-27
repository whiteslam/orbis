'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { Notice } from '@/components/career/use-run';

/** A result line under the control that caused it. `<output>`, so it is announced. */
export function NoticeLine({ notice, onDismiss }: Readonly<{ notice: Notice | null; onDismiss?: () => void }>) {
  if (!notice) return null;
  return (
    <output className={`fd-msg cr-notice ${notice.ok ? 'ok' : 'bad'}`}>
      <span>{notice.text}</span>
      {onDismiss && <button type="button" className="fd-link" onClick={onDismiss}>Dismiss</button>}
    </output>
  );
}

/** A spinning circle while `on`, otherwise the given icon. */
export function BusyIcon({ on, children, size = 14 }: Readonly<{ on: boolean; children?: ReactNode; size?: number }>) {
  if (on) return <LoaderCircle className="cr-spin" size={size} aria-hidden="true" />;
  return <>{children}</>;
}

/** A titled block inside a card or sheet. The heading is a real heading, styled as the house label. */
export function Block({ title, note, children, id, className }: Readonly<{ title: string; note?: ReactNode; children: ReactNode; id?: string; className?: string }>) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`cr-block${className ? ` ${className}` : ''}`} id={id} aria-labelledby={headingId}>
      <h2 className="fd-label" id={headingId}>{title}</h2>
      {note && <p className="cr-block-note">{note}</p>}
      {children}
    </section>
  );
}

/** Copies `value` and says so for a moment. */
export function CopyButton({ value, label }: Readonly<{ value: string; label: string }>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="cr-copy" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
