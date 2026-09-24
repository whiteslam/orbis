'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, LoaderCircle } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED'] as const;

type Rates = { date: string; rates: Record<string, number | null>; stale: boolean };

export function CurrencyCard() {
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

  return (
    <section className="currency-card" aria-labelledby="currency-title">
      <div className="currency-head">
        <ArrowLeftRight size={16} aria-hidden="true" />
        <strong id="currency-title">Rates to INR</strong>
        {data && <small>{data.stale ? 'Last saved · ' : ''}ECB, {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${data.date}T00:00:00Z`))}</small>}
      </div>
      {!data && !error && <p className="currency-muted"><LoaderCircle className="workbook-spinner" size={13} /> Loading rates…</p>}
      {error && <p className="currency-muted">{error}</p>}
      {data && (
        <div className="currency-grid">
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
