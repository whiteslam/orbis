'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { clearHomeCityAction, saveHomeCityAction } from '@/app/personal/actions';
import type { HomeLocation } from '@/lib/personal/repository';
import type { Integration } from '@/lib/providers/status';

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
    <form className="personal-form stack-card home-city" onSubmit={(event) => { event.preventDefault(); run(() => saveHomeCityAction(city)); }}>
      <strong><MapPin size={15} /> Home city</strong>
      <p className="home-city-note">{location.city ? `Weather uses ${location.city} when your browser location isn’t shared.` : 'Used for weather when your browser location isn’t shared.'}</p>
      <div className="home-city-row">
        <input value={city} onChange={(event) => setCity(event.currentTarget.value)} maxLength={80} placeholder={location.city ?? 'e.g. Pune'} aria-label="Home city" disabled={isPending} />
        <button className="finance-button primary" type="submit" disabled={isPending || city.trim().length < 2}>{isPending ? 'Saving…' : location.city ? 'Change' : 'Save'}</button>
        {location.city && <button className="finance-button secondary" type="button" disabled={isPending} onClick={() => run(clearHomeCityAction)}>Remove</button>}
      </div>
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </form>
  );
}

export function Integrations({ items, heading = true }: { items: Integration[]; heading?: boolean }) {
  return (
    <section className="integrations" aria-labelledby="integrations-title">
      {heading && <div className="integrations-head"><small>ORBIS SYSTEM</small><h3 id="integrations-title">Integrations</h3></div>}
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.state}>
            <i aria-hidden="true" />
            <div>
              <strong>{item.label}</strong>
              <small>{item.purpose}</small>
            </div>
            <div className="integration-status">
              <span>{STATE_LABEL[item.state]}</span>
              {item.detail && <small>{item.detail}</small>}
              {item.lastSyncAt && <small>Last synced {syncTime(item.lastSyncAt)}</small>}
              {item.usage && <small>{item.usage.used}/{item.usage.limit} calls today</small>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
