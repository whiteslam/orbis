'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED'] as const;

type Rates = { date: string; rates: Record<string, number | null>; stale: boolean };

const UNAVAILABLE = 'Exchange rates are unavailable right now.';

// A body that is not JSON reads as empty, so the status alone decides.
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function loadRates(): Promise<{ data: Rates } | { error: string }> {
  try {
    const response = await fetch(`/api/currency?base=INR&symbols=${CURRENCIES.join(',')}`);
    const body = await readBody(response);
    if (response.ok) return { data: body as Rates };
    return { error: (body as { error?: string }).error ?? UNAVAILABLE };
  } catch {
    return { error: UNAVAILABLE };
  }
}

function sourceLine(data: Rates, note?: string) {
  const saved = data.stale ? 'Last saved · ' : '';
  const midnight = `${data.date}T00:00:00Z`;
  const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(midnight));
  const extra = note ? ` · ${note}` : '';
  return `${saved}ECB, ${day}${extra}`;
}

const inr = (perInr: number | null | undefined) => (perInr ? `₹${(1 / perInr).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—');

function peekLine(data: Rates | null, error: string | null) {
  if (error) return 'Unavailable';
  return data ? `1 USD ${inr(data.rates.USD)}` : 'Loading…';
}

// Reference rates to INR. `note` adds to the source line (e.g. "works without any account").
export function CurrencyCard({ note }: Readonly<{ note?: string }>) {
  const [data, setData] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reference, not something to act on: one line until asked for.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadRates().then((result) => {
      if (cancelled) return;
      if ('data' in result) setData(result.data);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, []);

  const source = data ? sourceLine(data, note) : null;
  const peek = peekLine(data, error);

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
