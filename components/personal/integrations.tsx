'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clearHomeCityAction, saveHomeCityAction } from '@/app/personal/actions';
import type { HomeLocation } from '@/lib/personal/repository';
import type { Integration } from '@/lib/providers/status';
import { safeAction } from '@/lib/client/safe-action';

const STATE_LABEL: Record<Integration['state'], string> = {
  connected: 'Connected',
  idle: 'Ready',
  not_configured: 'Not configured',
  attention: 'Needs attention',
  degraded: 'Temporarily unavailable',
};

function syncTime(value: string) {
  const date = new Date(value);
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return new Intl.DateTimeFormat('en-IN', sameDay ? { timeStyle: 'short', timeZone: 'Asia/Kolkata' } : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date);
}

export function HomeCityEditor({ location }: { location: HomeLocation }) {
  const router = useRouter();
  const [city, setCity] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        setCity('');
        router.refresh();
      }
    });
  }

  if (location.state === 'setup') return null;

  return (
    <form className="fd-form" onSubmit={(event) => { event.preventDefault(); run(() => safeAction(saveHomeCityAction)(city)); }}>
      <label className="fd-field wide pf-city" htmlFor="home-city">Home city</label>
      <div className="pf-city-row">
        <input id="home-city" value={city} onChange={(event) => setCity(event.currentTarget.value)} maxLength={80} placeholder={location.city ?? 'e.g. Pune'} disabled={isPending} />
        <button className="pf-pill" type="submit" disabled={isPending || city.trim().length < 2}>{isPending ? 'Saving…' : location.city ? 'Change' : 'Save'}</button>
      </div>
      <p className="fd-note tight">{location.city ? `Weather uses ${location.city} when your browser location isn’t shared.` : 'Used for weather when your browser location isn’t shared.'}</p>
      {location.city && <div className="fd-act pf-act"><button className="fd-link alert" type="button" disabled={isPending} onClick={() => run(safeAction(clearHomeCityAction))}>Remove {location.city}</button></div>}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </form>
  );
}

export function Integrations({ items, heading = true }: { items: Integration[]; heading?: boolean }) {
  return (
    <section className="pf-services" aria-labelledby={heading ? 'integrations-title' : undefined} aria-label={heading ? undefined : 'Data services'}>
      {heading && <h2 className="fd-label" id="integrations-title">Integrations</h2>}
      {items.map((item) => (
        <div key={item.id} className="fd-line pf-service">
          <span className="fd-two">
            {item.label}
            <small>{item.purpose}</small>
          </span>
          <span className="pf-service-state">
            <b className={item.state === 'connected' || item.state === 'idle' ? 'fd-yes' : item.state === 'not_configured' ? 'empty' : 'pf-warn'}>{STATE_LABEL[item.state]}</b>
            {item.detail && <small>{item.detail}</small>}
            {item.lastSyncAt && <small>Last synced {syncTime(item.lastSyncAt)}</small>}
            {item.usage && <small>{item.usage.used}/{item.usage.limit} calls today</small>}
          </span>
        </div>
      ))}
    </section>
  );
}
