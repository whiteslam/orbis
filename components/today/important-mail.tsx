'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Mail } from 'lucide-react';
import type { ImportantMailResult } from '@/lib/gmail/types';
import { acknowledgeMailAction } from '@/app/home/mail-actions';
import { safeAction } from '@/lib/client/safe-action';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: ImportantMailResult };

// Home remounts on every tab switch; reuse the last answer for a few minutes
// rather than asking Gmail again each time.
let lastResult: { at: number; result: ImportantMailResult } | null = null;
const CLIENT_TTL_MS = 5 * 60 * 1000;
const FIRST = 3;

/** Keeps the cached list in step with a "Got it", so a tab switch does not bring the mail back. */
function remember(result: ImportantMailResult) {
  lastResult = { at: lastResult?.at ?? Date.now(), result };
}

function when(iso: string) {
  const date = new Date(iso);
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  return sameDay.format(date) === sameDay.format(new Date())
    ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date)
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date);
}

/**
 * Gmail's Important + Primary mail from the last two weeks, with alerts left
 * out, sitting right under the brief. Each one has a "Got it": once tapped it
 * is gone for good, so the list is only ever what you have not dealt with, and
 * when that is nothing the section is not drawn at all.
 */
export function ImportantMail() {
  const [state, setState] = useState<State>(() => (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS ? { status: 'ready', result: lastResult.result } : { status: 'loading' }));
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gone from the list at once; the server only has to remember it. A failure
  // puts it back, so a mail is never hidden without the acknowledgement saved.
  function acknowledge(id: string) {
    if (state.status !== 'ready' || state.result.state !== 'ok') return;
    const before = state.result;
    const after = { ...before, messages: before.messages.filter((message) => message.id !== id) };
    remember(after);
    setState({ status: 'ready', result: after });
    setError(null);
    void safeAction(acknowledgeMailAction)(id).then((result) => {
      if (result.success) return;
      remember(before);
      setState({ status: 'ready', result: before });
      setError(result.message);
    });
  }

  useEffect(() => {
    if (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS) return;
    let live = true;
    void fetch('/api/home/mail', { cache: 'no-store' })
      .then(async (response) => (response.ok ? await response.json() as ImportantMailResult : null))
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        if (!result) return setState({ status: 'error' });
        // Errors are not cached, so the next visit retries.
        lastResult = { at: Date.now(), result };
        setState({ status: 'ready', result });
      });
    return () => { live = false; };
  }, []);

  if (state.status === 'loading') {
    return <p className="fd-weather-quiet" role="status"><LoaderCircle className="workbook-spinner" size={14} /> Checking important mail…</p>;
  }
  if (state.status === 'error') {
    return <p className="fd-weather-quiet"><Mail size={14} aria-hidden="true" /> Gmail couldn’t be reached. Opening Home again tries once more.</p>;
  }

  const { result } = state;
  // Not connected, or access expired: one compact card, the same shape as the
  // setup reminder, so it reads as something to tap rather than a stray line.
  if (result.state === 'disconnected' || result.state === 'reconnect') {
    const expired = result.state === 'reconnect';
    return (
      <section className="setup-list fd-mail-connect" aria-label="Gmail">
        <a className="setup-row" href="/auth/gmail/start">
          <span className="fd-tile" aria-hidden="true"><Mail size={15} strokeWidth={1.9} /></span>
          <span className="setup-row-label">
            {expired ? 'Reconnect Gmail' : 'Connect Gmail'}
            <small>{expired ? `Google expired access for ${result.email}` : 'See your important mail here. Read-only.'}</small>
          </span>
          <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
        </a>
      </section>
    );
  }

  if (!result.messages.length && !error) return null;

  const shown = showAll ? result.messages : result.messages.slice(0, FIRST);
  const unread = result.messages.filter((message) => message.unread).length;
  return (
    <section className="fd-quiet fd-mail" aria-labelledby="mail-title">
      <h2 id="mail-title">New mail{unread ? ` · ${unread} unread` : ''}</h2>
      {error && <p className="fd-msg bad" role="alert">{error}</p>}
      {shown.map((message) => (
        <div key={message.id} className={`fd-mail-row${message.unread ? ' unread' : ''}`}>
          <a className="fd-mail-open" href={message.url} target="_blank" rel="noopener noreferrer">
            <span className="fd-mail-top"><b>{message.from}</b><time dateTime={message.receivedAt} suppressHydrationWarning>{when(message.receivedAt)}</time></span>
            <span className="fd-mail-subject">{message.subject}</span>
            {message.snippet && <span className="fd-mail-snippet">{message.snippet}</span>}
          </a>
          <button className="fd-mail-ack" type="button" onClick={() => acknowledge(message.id)} aria-label={`Got it: ${message.subject}`}>
            <Check size={13} strokeWidth={2.4} aria-hidden="true" />Got it
          </button>
        </div>
      ))}
      {result.messages.length > FIRST && (
        <button className="fd-link fd-mail-more" type="button" onClick={() => setShowAll((open) => !open)}>
          {showAll ? 'Show fewer' : `Show all ${result.messages.length}`}
        </button>
      )}
    </section>
  );
}
