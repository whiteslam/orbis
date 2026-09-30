'use client';

import { useEffect, useState, useTransition } from 'react';
import { completeHeadsupAction, dismissHeadsupAction, setHeadsupKindAction, snoozeHeadsupAction } from '@/app/headsups/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { Headsup, HeadsupAction, HeadsupKind, HeadsupsResponse } from '@/lib/headsups/types';

const SHOWN = 3;

const SOURCE: Record<string, string> = { money: 'your spending', routine: 'your routines', health: 'your health data' };

function source(headsup: Headsup) {
  const from = SOURCE[headsup.kind.split('.')[0]] ?? 'your data';
  return `From ${from} · worded by ${headsup.wordedBy === 'ai' ? 'AI' : 'Orbis'}`;
}

/** What Orbis noticed without being asked. Renders nothing when there is nothing. */
export function Headsups({ onAction }: { onAction: (action: HeadsupAction) => void }) {
  const [data, setData] = useState<HeadsupsResponse | null>(null);
  const [all, setAll] = useState(false);
  const [offer, setOffer] = useState<HeadsupKind | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void fetch('/api/home/headsups', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() as Promise<HeadsupsResponse> : null))
      .then((result) => { if (live && result) setData(result); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // A push opens /?headsup=<id>; bring that one into view once it has loaded.
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('headsup');
    if (!id || !data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAll(true);
    requestAnimationFrame(() => document.getElementById(`headsup-${id}`)?.scrollIntoView({ block: 'center' }));
  }, [data]);

  if (!data || !data.headsups.length) return null;
  const shown = all ? data.headsups : data.headsups.slice(0, SHOWN);

  function remove(id: string) {
    setData((current) => current && { ...current, headsups: current.headsups.filter((item) => item.id !== id) });
  }

  function act(headsup: Headsup, kind: 'go' | 'snooze' | 'dismiss') {
    remove(headsup.id);
    if (kind === 'dismiss' && data?.offerOff.includes(headsup.kind)) setOffer(headsup.kind);
    const action = kind === 'go' ? completeHeadsupAction : kind === 'snooze' ? snoozeHeadsupAction : dismissHeadsupAction;
    startTransition(async () => { await safeAction(action)(headsup.id); });
    if (kind === 'go') onAction(headsup.action);
  }

  return (
    <section className="hu-card" aria-labelledby="headsups-title">
      <h2 id="headsups-title" className="fd-label">Heads-ups</h2>
      {shown.map((headsup) => (
        <article className={`hu-item${headsup.urgency === 'urgent' ? ' urgent' : ''}`} id={`headsup-${headsup.id}`} key={headsup.id}>
          <strong>{headsup.title}</strong>
          <p>{headsup.body}</p>
          <small>{source(headsup)}</small>
          <div className="hu-actions">
            <button type="button" className="fd-button" onClick={() => act(headsup, 'go')}>{headsup.actionLabel}</button>
            <button type="button" className="hu-quiet" onClick={() => act(headsup, 'snooze')}>Snooze 3 days</button>
            <button type="button" className="hu-quiet" onClick={() => act(headsup, 'dismiss')}>Dismiss</button>
          </div>
        </article>
      ))}
      {!all && data.headsups.length > SHOWN && (
        <button type="button" className="hu-more" onClick={() => setAll(true)}>See all {data.headsups.length}</button>
      )}
      {offer && (
        <div className="hu-offer" role="status">
          <span>You’ve dismissed this a few times. Stop checking for it?</span>
          <button type="button" className="hu-quiet" onClick={() => { const kind = offer; setOffer(null); startTransition(async () => { await safeAction(setHeadsupKindAction)(kind, false); }); }}>Stop checking</button>
          <button type="button" className="hu-quiet" onClick={() => setOffer(null)}>Keep it</button>
        </div>
      )}
    </section>
  );
}
