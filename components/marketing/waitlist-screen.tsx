import { Suspense } from 'react';
import Link from 'next/link';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { WaitlistForm } from '@/components/marketing/waitlist-form';
import { waitlistCount } from '@/lib/marketing/waitlist';
import { SITE_NAME } from '@/lib/site';

// What Orbis does, in the order someone new would ask. Rows on the ground
// rather than cards: three boxes side by side would read as a pricing table.
const WHAT = [
  ['One daily brief', 'Your money, your health and the day ahead, written out once. Nothing to dig for and nothing to swipe through.'],
  ['Money in one place', 'Spending and broker holdings together. Read-only throughout: Orbis can see a balance and can never move it.'],
  ['Health and routines', 'Steps, journal and the times your day already has, tracked without turning into another chore.'],
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
 * it is deliberately thin: no sign-in link, no mention of where the app itself
 * lives, and nothing about whoever already uses it. The only interactive thing
 * on the page is one email field.
 */
export function WaitlistScreen() {
  return (
    <div className="wl-shell">
      <header className="wl-header">
        <span className="wl-brand">
          <OrbisMark size={28} />
          <strong>{SITE_NAME}</strong>
        </span>
        <span className="wl-badge">Private beta</span>
      </header>

      <main className="wl-main">
        <section className="wl-hero">
          <h1>One calm page for your money, your health and your day.</h1>
          <p className="wl-lede">
            {SITE_NAME} reads what you connect and writes you a single brief each morning, in plain
            sentences. It is opening in small batches. Leave your email and we’ll send your invite
            when it’s your turn.
          </p>
          <WaitlistForm />
          {/* Streamed on its own, so one database round trip cannot hold up the
              page a stranger is waiting on. It appears under the form a moment
              later, or not at all if the count could not be read. */}
          <Suspense fallback={null}><JoinedCount /></Suspense>
        </section>

        <section className="wl-what" aria-label={`What ${SITE_NAME} does`}>
          {WHAT.map(([title, body]) => (
            <article className="wl-row" key={title}>
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
