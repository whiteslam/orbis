'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { joinWaitlistAction } from '@/app/waitlist/actions';

/**
 * The only thing a stranger can do here. One field, one button, and a place in
 * the queue once it goes through.
 *
 * `joined` holds the address rather than a boolean so the confirmation can
 * repeat it back — the one place an email appears on a public page, and it is
 * the visitor's own, typed a second earlier.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ email: string; position: number | null } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await joinWaitlistAction({ email, website });
      if (result.ok) setJoined({ email: email.trim(), position: result.position });
      else setError(result.message);
    });
  }

  if (joined) {
    return (
      <div className="wl-done" aria-live="polite">
        <span className="wl-done-mark" aria-hidden="true"><Check size={18} strokeWidth={2.4} /></span>
        <h2>You’re on the list.</h2>
        <p>
          {joined.position
            ? <>You’re number <strong>{joined.position}</strong>. We’ll email <strong>{joined.email}</strong> when your invite is ready.</>
            : <>We’ll email <strong>{joined.email}</strong> when your invite is ready.</>}
        </p>
        <button type="button" className="wl-text-button" onClick={() => { setJoined(null); setEmail(''); }}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form className="wl-form" onSubmit={submit} noValidate>
      <label className="wl-field">
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          maxLength={254}
          value={email}
          onChange={(event) => { setEmail(event.target.value); setError(null); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'wl-error' : undefined}
        />
      </label>
      {/* Bots fill this in; people never see it. */}
      <div className="wl-honeypot" aria-hidden="true">
        <label htmlFor="wl-website">Website</label>
        <input id="wl-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </div>
      {error ? <p id="wl-error" className="wl-error" role="alert">{error}</p> : null}
      <button type="submit" className="wl-submit" disabled={pending}>
        {pending ? 'Joining…' : <>Join the waitlist <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" /></>}
      </button>
      <p className="wl-fineprint">One email when your invite is ready. Nothing else, ever.</p>
    </form>
  );
}
