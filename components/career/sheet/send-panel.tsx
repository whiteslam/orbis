'use client';

import { useState } from 'react';
import { CheckCheck, ExternalLink, Send } from 'lucide-react';
import { markAppliedAction, sendApplicationAction } from '@/app/career/actions';
import { BusyIcon, CopyButton, NoticeLine } from '@/components/career/bits';
import { routeText } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerApplication } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

/**
 * What Send left to do: a page or a Gmail window the owner finishes by hand.
 * `message` says why, when a direct send (Recruitee, or an email with no
 * address to send to) fell back to the apply page.
 */
export type HandOff = { kind: 'opened' | 'compose'; url: string; message?: string };

function openTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * After a link apply or a compose window: the page again, every field ready
 * to copy, and "I applied", which is the only thing that counts it as sent.
 */
export function ApplyKit({ application, detail, handOff, onDetail }: Readonly<{ application: CareerApplication; detail: ApplicationDetail; handOff: HandOff | null; onDetail: (detail: ApplicationDetail) => void }>) {
  const { busy, notice, run } = useRun();
  const url = handOff?.url ?? detail.job.applyUrl ?? detail.job.url;
  const compose = handOff?.kind === 'compose';
  const applied = () => run('applied', () => markAppliedAction(application.id), (next) => {
    onDetail(next);
    return 'Counted as sent. Orbis now watches your Gmail for their reply.';
  });

  return (
    <section className="cr-block cr-kit" aria-labelledby="cr-kit-title">
      <h2 className="fd-label" id="cr-kit-title">{compose ? 'Finish in Gmail' : 'Finish on their site'}</h2>
      {handOff?.message && <output className="fd-msg cr-kit-why">{handOff.message}</output>}
      <p className="cr-block-note">
        {compose
          ? 'A ready email opened in Gmail. Download the PDF below, attach it, send, then come back and press “I applied”.'
          : 'The apply page opened in a new tab. Copy each field across, upload the PDF below, submit, then press “I applied”.'}
      </p>
      <a className="cr-kit-open" href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} aria-hidden="true" />
        {compose ? 'Open the Gmail draft again' : 'Open the apply page again'}
      </a>
      {!compose && detail.pasteKit.length > 0 && (
        <dl className="cr-paste">
          {detail.pasteKit.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>
                <span>{field.value}</span>
                <CopyButton value={field.value} label={field.label} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="fd-act">
        <button type="button" onClick={applied} disabled={busy !== null}>
          <BusyIcon on={busy === 'applied'}><CheckCheck size={15} aria-hidden="true" /></BusyIcon>
          I applied
        </button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

/**
 * The Send bar. Enabled only when the application is ready; one press calls
 * the action once (useRun ignores presses while one is running, and the
 * button is disabled while it runs). Sent: the sheet updates. Opened or
 * compose: the page opens in a new tab and the kit takes over.
 */
export function SendBar({ application, canSend, onDetail, onHandOff, onSent }: Readonly<{
  application: CareerApplication;
  canSend: boolean;
  onDetail: (detail: ApplicationDetail) => void;
  onHandOff: (handOff: HandOff) => void;
  /** Sent: the bar goes with the status, so the sheet keeps the confirmation. */
  onSent: (text: string) => void;
}>) {
  const { busy, notice, run } = useRun();
  const [why, setWhy] = useState(false);
  const route = routeText(application.route, canSend);
  const ready = application.status === 'ready';
  const sending = busy === 'send' || application.status === 'sending';

  const send = () => run('send', () => sendApplicationAction(application.id), (outcome) => {
    if (outcome.kind === 'sent') {
      onSent('Sent. Orbis will tell you when they reply.');
      onDetail(outcome.detail);
      return;
    }
    openTab(outcome.url);
    onHandOff(outcome.kind === 'opened' && outcome.message ? { kind: 'opened', url: outcome.url, message: outcome.message } : { kind: outcome.kind, url: outcome.url });
    onDetail(outcome.detail);
  });

  let label = 'Send';
  if (sending) label = 'Sending…';
  else if (application.route === 'link') label = 'Send: open the apply page';
  else if (application.route === 'email' && !canSend) label = 'Send: open in Gmail';

  return (
    <div className="cr-sendbar">
      <div className="cr-sendbar-route">
        <button type="button" className="cr-route" aria-expanded={why} onClick={() => setWhy((open) => !open)}>
          <b>{route.title}</b>
          <span>{why ? 'Hide how' : 'How this sends'}</span>
        </button>
        {why && <p>{route.body}</p>}
      </div>
      <button type="button" className="cr-send" onClick={send} disabled={!ready || busy !== null}>
        <BusyIcon on={sending} size={16}><Send size={16} aria-hidden="true" /></BusyIcon>
        {label}
      </button>
      {!ready && !sending && <p className="fd-hint">Send opens once the draft is ready.</p>}
      <NoticeLine notice={notice} />
    </div>
  );
}
