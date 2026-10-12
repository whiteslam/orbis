import { Suspense } from 'react';
import Link from 'next/link';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { WaitlistBackdrop } from '@/components/marketing/waitlist-backdrop';
import { WaitlistForm } from '@/components/marketing/waitlist-form';
import { waitlistCount } from '@/lib/marketing/waitlist';
import { SITE_NAME } from '@/lib/site';

// What Orbis does, in the order someone new would ask. Rows on the ground
// rather than cards: three boxes side by side would read as a pricing table.
const WHAT = [
  ['01', 'One daily brief', 'Your money, your health and the day ahead, written out once. Nothing to dig for and nothing to swipe through.'],
  ['02', 'Money in one place', 'Spending and broker holdings together. Read-only throughout: Orbis can see a balance and can never move it.'],
  ['03', 'Health and routines', 'Steps, journal and the times your day already has, tracked without turning into another chore.'],
] as const;

// Three promises, said once under the form where someone deciding whether to
// hand over an email is looking.
const TRUST = [
  [ShieldCheck, 'Read-only connections'],
  [EyeOff, 'Never trains AI on your data'],
  [Lock, 'Private by default'],
] as const;

/** How many have joined, once the number arrives. Silent when it cannot be read. */
async function JoinedCount() {
  const count = await waitlistCount();
  if (!count || count < 1) return null;
  return (
    <p className="wl-joined">
      <strong>{count.toLocaleString('en-GB')}</strong> {count === 1 ? 'person has' : 'people have'} joined so far.
    </p>
  );
}

/**
 * The front door. Everything a signed-out visitor is ever shown lives here, so
 * it stays thin: a way in for people who already have an account, one email
 * field for everyone else, and nothing about whoever already uses the app.
 * "Log in" is a plain anchor, not a <Link>: a Link would prefetch the sign-in
 * page's scripts, which name the app's own route, for every stranger who opens
 * this page.
 */
export function WaitlistScreen() {
  return (
    <div className="wl-shell">
      <header className="wl-header">
        <span className="wl-brand">
          <OrbisMark size={28} />
          <strong>{SITE_NAME}</strong>
        </span>
        <nav className="wl-actions" aria-label="Account">
          <a href="/login" className="wl-login">Log in</a>
          <a href="#join" className="wl-join-link">Join waitlist</a>
        </nav>
      </header>

      <main className="wl-main">
        <section className="wl-hero">
          <WaitlistBackdrop />
          <div className="wl-hero-copy">
            <p className="wl-eyebrow"><span className="wl-dot" aria-hidden="true" />Private beta · opening in small batches</p>
            <h1>Everything you keep track of, pulled into <span className="wl-grad">one calm page.</span></h1>
            <p className="wl-lede">
              At the centre of your money, health and routines, {SITE_NAME} writes you a single
              brief each morning, in plain sentences. It is opening in small batches. Leave your
              email and we’ll send your invite when it’s your turn.
            </p>
            <div id="join" className="wl-card"><WaitlistForm /></div>
            {/* Streamed on its own, so one database round trip cannot hold up the
                page a stranger is waiting on. It appears under the form a moment
                later, or not at all if the count could not be read. */}
            <Suspense fallback={null}><JoinedCount /></Suspense>
            <ul className="wl-trust">
              {TRUST.map(([Icon, label]) => (
                <li key={label}><Icon size={14} strokeWidth={2.2} aria-hidden="true" />{label}</li>
              ))}
            </ul>
          </div>
        </section>

        <div className="wl-body">
          <section className="wl-what" aria-label={`What ${SITE_NAME} does`}>
            {WHAT.map(([num, title, body]) => (
              <article className="wl-row" key={title}>
                <span className="wl-num" aria-hidden="true">{num}</span>
                <h2>{title}</h2>
                <p>{body}</p>
              </article>
            ))}
          </section>

          <section className="wl-note" aria-labelledby="wl-privacy">
            <h2 id="wl-privacy">AI that never trains on you</h2>
            <p>
              Anything touching your money, health or notes only ever reaches providers whose models
              are not trained on it. Every connection is read-only, and you can remove any of them at
              any time. <Link href="/privacy">Privacy Policy</Link>
            </p>
          </section>
        </div>
      </main>

      <footer className="wl-footer">
        <ul>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/support">Support</Link></li>
        </ul>
        <p>&copy; {new Date().getFullYear()} {SITE_NAME}</p>
      </footer>
    </div>
  );
}
