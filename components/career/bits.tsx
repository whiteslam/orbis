'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { Notice } from '@/components/career/use-run';
import { httpsHref, linkHost } from '@/lib/career/links';

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

/**
 * A link built from stored data (a listing, an apply page): clickable only
 * when it is https, checked here as it is drawn; otherwise the same content
 * as plain text.
 */
export function SafeLink({ url, className, children }: Readonly<{ url: string | null | undefined; className?: string; children: ReactNode }>) {
  const href = httpsHref(url);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * A meeting link from an invite email: always shows the host it goes to, and
 * is a link only when https. The invite was read from mail, so the host is
 * the owner's check that it really is Meet, Zoom or Teams.
 */
export function MeetingLink({ url }: Readonly<{ url: string }>) {
  const href = httpsHref(url);
  const host = linkHost(url);
  if (!href || !host) return <span>Meeting link{host ? ` on ${host}` : ''} not shown: it isn’t a secure (https) address. Check the invite email.</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      Meeting link on {host}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
