'use client';

import { useEffect, useState } from 'react';
import { FieldLabel } from '@/components/field/field';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED'] as const;

type Rates = { date: string; rates: Record<string, number | null>; stale: boolean };

// Reference rates to INR. `note` adds to the source line (e.g. "works without any account").
export function CurrencyCard({ note }: { note?: string }) {
  const [data, setData] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="fd-rates" aria-label="Rates to INR">
      <FieldLabel>Rates to INR</FieldLabel>
      <p className="fd-rates-src">{error ?? source ?? 'Loading rates…'}</p>
      {data && (
        <div className="fd-rates-grid">
          {CURRENCIES.map((code) => {
            const perInr = data.rates[code];
            return (
              <div key={code}>
                <span>1 {code}</span>
                <strong>{perInr ? `₹${(1 / perInr).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'}</strong>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
