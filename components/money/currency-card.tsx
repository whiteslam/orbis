'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED'] as const;

type Rates = { date: string; rates: Record<string, number | null>; stale: boolean };

// Reference rates to INR. `note` adds to the source line (e.g. "works without any account").
export function CurrencyCard({ note }: { note?: string }) {
  const [data, setData] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reference, not something to act on: one line until asked for.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/currency?base=INR&symbols=${CURRENCIES.join(',')}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok) setData(body as Rates);
        else setError(body.error ?? 'Exchange rates are unavailable right now.');
      })
      .catch(() => !cancelled && setError('Exchange rates are unavailable right now.'));
    return () => { cancelled = true; };
  }, []);

  const source = data
    ? `${data.stale ? 'Last saved · ' : ''}ECB, ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${data.date}T00:00:00Z`))}${note ? ` · ${note}` : ''}`
    : null;

  const inr = (perInr: number | null | undefined) => (perInr ? `₹${(1 / perInr).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—');
  const peek = error ? 'Unavailable' : data ? `1 USD ${inr(data.rates.USD)}` : 'Loading…';

  return (
    <section className="fd-rates" aria-label="Rates to INR">
      <button className="fd-rates-head" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fd-label">Rates to INR</span>
        <span className="fd-rates-peek">{peek}<ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" /></span>
      </button>
      {open && (
        <>
          <p className="fd-rates-src">{error ?? source ?? 'Loading rates…'}</p>
          {data && (
            <div className="fd-rates-grid">
              {CURRENCIES.map((code) => (
                <div key={code}>
                  <span>1 {code}</span>
                  <strong>{inr(data.rates[code])}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
