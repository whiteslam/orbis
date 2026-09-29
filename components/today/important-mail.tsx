'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Mail } from 'lucide-react';
import type { ImportantMailResult } from '@/lib/gmail/types';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: ImportantMailResult };

// Home remounts on every tab switch; reuse the last answer for a few minutes
// rather than asking Gmail again each time.
let lastResult: { at: number; result: ImportantMailResult } | null = null;
const CLIENT_TTL_MS = 5 * 60 * 1000;
const FIRST = 5;

function when(iso: string) {
  const date = new Date(iso);
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  return sameDay.format(date) === sameDay.format(new Date())
    ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date)
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date);
}

/** Gmail's Important + Primary mail from the last two weeks, with alerts left out. */
export function ImportantMail() {
  const [state, setState] = useState<State>(() => (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS ? { status: 'ready', result: lastResult.result } : { status: 'loading' }));
  const [showAll, setShowAll] = useState(false);

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
  if (result.state === 'disconnected') {
    return (
      <a className="fd-weather-quiet fd-weather-button" href="/auth/gmail/start">
        <Mail size={14} aria-hidden="true" /> Connect Gmail to see your important mail here. Read-only.
      </a>
    );
  }
  if (result.state === 'reconnect') {
    return (
      <a className="fd-weather-quiet fd-weather-button" href="/auth/gmail/start">
        <Mail size={14} aria-hidden="true" /> Google expired access for {result.email}. Reconnect Gmail.
      </a>
    );
  }

  const shown = showAll ? result.messages : result.messages.slice(0, FIRST);
  const unread = result.messages.filter((message) => message.unread).length;
  return (
    <section className="fd-quiet fd-mail" aria-labelledby="mail-title">
      <h2 id="mail-title">Important mail{unread ? ` · ${unread} unread` : ''}</h2>
      {shown.length ? shown.map((message) => (
        <a key={message.id} className={`fd-mail-row${message.unread ? ' unread' : ''}`} href={message.url} target="_blank" rel="noopener noreferrer">
          <span className="fd-mail-top"><b>{message.from}</b><time dateTime={message.receivedAt} suppressHydrationWarning>{when(message.receivedAt)}</time></span>
          <span className="fd-mail-subject">{message.subject}</span>
          {message.snippet && <span className="fd-mail-snippet">{message.snippet}</span>}
        </a>
      )) : <p className="fd-empty">Nothing important in the last two weeks.</p>}
      {result.messages.length > FIRST && (
        <button className="fd-link fd-mail-more" type="button" onClick={() => setShowAll((open) => !open)}>
          {showAll ? 'Show fewer' : `Show all ${result.messages.length}`}
        </button>
      )}
    </section>
  );
}
