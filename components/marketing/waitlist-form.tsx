'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { joinWaitlistAction } from '@/app/waitlist/actions';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await joinWaitlistAction({ email, website });
      if (result.ok) setJoined(email.trim());
      else setError(result.message);
    });
  }

  if (joined) {
    return (
      <section className="mkt-waitlist" aria-live="polite">
        <h1>You’re on the list.</h1>
        <p className="mkt-hero-sub">
          We’ll email <strong>{joined}</strong> when your invite is ready.
        </p>
        <button type="button" className="mkt-text-button" onClick={() => { setJoined(null); setEmail(''); }}>
          Use a different email
        </button>
      </section>
    );
  }

  return (
    <section className="mkt-waitlist">
      <h1>Join the waitlist.</h1>
      <p className="mkt-hero-sub">
        Orbis is opening in small batches. Leave your email and we’ll send your invite when it’s your turn.
      </p>
      <form className="mkt-waitlist-form" onSubmit={submit} noValidate>
        <label htmlFor="waitlist-email">Email</label>
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          maxLength={254}
          value={email}
          onChange={(event) => { setEmail(event.target.value); setError(null); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'waitlist-error' : undefined}
        />
        <div className="mkt-honeypot" aria-hidden="true">
          <label htmlFor="waitlist-website">Website</label>
          <input id="waitlist-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </div>
        {error ? <p id="waitlist-error" className="mkt-error" role="alert">{error}</p> : null}
        <button type="submit" className="mkt-submit" disabled={pending}>
          {pending ? 'Joining…' : 'Join the waitlist'}
        </button>
        <p className="mkt-fineprint">One email when your invite is ready. Nothing else.</p>
      </form>
    </section>
  );
}
