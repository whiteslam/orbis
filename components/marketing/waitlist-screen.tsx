import { Suspense } from 'react';
import Link from 'next/link';
import { Download, Lock, PowerOff, ShieldCheck, Unplug } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { EclipseBackdrop } from '@/components/marketing/eclipse-backdrop';
import { WaitlistForm } from '@/components/marketing/waitlist-form';
import { waitlistCount } from '@/lib/marketing/waitlist';
import { SITE_NAME } from '@/lib/site';

// What the brief draws on, beside the sample of it. The brief itself is the
// section's heading; these two are where its sentences come from.
const COVERS = [
  ['Money in one place', 'Spending and broker holdings together. Read-only throughout: Orbis can see a balance and can never move it.'],
  ['Health and routines', 'Steps, journal and the times your day already has, tracked without turning into another chore.'],
] as const;

// Three promises, said once under the form where someone deciding whether to
// hand over an email is looking. Only what is true today: the AI can be
// switched off (Settings → AI), and nothing promises how a provider trains.
const TRUST = [
  [ShieldCheck, 'Read-only connections'],
  [PowerOff, 'AI you can switch off'],
  [Lock, 'Private by default'],
] as const;

// What a person controls, each a real setting today: connections are
// read-only, each can be removed (Settings → Connections), the AI has its own
// switch (Settings → AI), and export and deletion live in Settings → Account.
const CONTROLS = [
  [ShieldCheck, 'Every connection is read-only.'],
  [Unplug, 'Remove any connection at any time.'],
  [PowerOff, 'Switch the AI off whenever you like.'],
  [Download, 'Download your data, or delete your account.'],
] as const;

/**
 * A morning brief as the app writes it: a greeting, the time, one paragraph,
 * and where its numbers came from. Built rather than captured, because a
 * screenshot of a real brief would show a real person's money. The caption
 * says the figures are made up.
 */
function SampleBrief() {
  return (
    <figure className="wl-sample" data-slot="sample-brief">
      <div className="wl-sample-sheet">
        <p className="wl-sample-head">
          <OrbisMark size={22} />
          <b>Good morning</b>
          <time>7:30 am</time>
        </p>
        <p className="wl-sample-text">
          It’s 24° and clear, good for the walk you put in for eight. You spent ₹1,840 yesterday, most of
          it on groceries, which leaves ₹12,600 of this month’s budget. Your holdings closed 0.4% up. You’re
          at 4,200 steps; a walk after lunch gets you to your usual.
        </p>
        <p className="wl-sample-from">From your spending, your portfolio, your steps and your routines</p>
      </div>
      <figcaption>A sample brief. The figures are made up.</figcaption>
    </figure>
  );
}

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
          <EclipseBackdrop />
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

        {/* The product, then the promise, then the door again. */}
        <section className="wl-brief" aria-labelledby="wl-brief-title">
          <div className="wl-wrap wl-brief-grid">
            {/* Three children placed by grid areas: on a desktop the sample spans
                both rows on the right; on a phone it follows the lede, so the
                picture is not left below both items. */}
            <div className="wl-brief-head">
              <h2 id="wl-brief-title">One daily brief</h2>
              <p className="wl-brief-lede">
                Your money, your health and the day ahead, written out once. Nothing to dig for and
                nothing to swipe through.
              </p>
            </div>
            <SampleBrief />
            <ul className="wl-covers">
              {COVERS.map(([title, body]) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The name, set as large as the container allows, straddling the line
            where the dark ground meets the privacy band. Decorative: the name
            is already in the header, so screen readers skip it. */}
        <div className="wl-bigmark" aria-hidden="true">
          <div className="wl-wrap"><p>{SITE_NAME}</p></div>
        </div>

        <section className="wl-private" aria-labelledby="wl-private-title">
          <div className="wl-wrap wl-private-grid">
            <div>
              <h2 id="wl-private-title">Only what you connect</h2>
              <p className="wl-private-lede">{SITE_NAME} only uses what you connect or upload, and you decide what that is.</p>
            </div>
            <div>
              <ul className="wl-controls">
                {CONTROLS.map(([Icon, line]) => (
                  <li key={line}><Icon size={20} strokeWidth={1.9} aria-hidden="true" /><span>{line}</span></li>
                ))}
              </ul>
              <p className="wl-controls-more"><Link href="/privacy">Privacy Policy</Link></p>
            </div>
          </div>
        </section>

        <section className="wl-close" aria-labelledby="wl-close-title">
          <div className="wl-wrap wl-close-grid">
            <h2 id="wl-close-title">Your invite, when it’s your turn</h2>
            <div className="wl-close-form"><WaitlistForm /></div>
          </div>
        </section>
      </main>

      <footer className="wl-footer">
        <span className="wl-footer-brand"><OrbisMark size={22} /><strong>{SITE_NAME}</strong></span>
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
