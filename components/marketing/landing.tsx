import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';

// The signed-out home page: what Orbis is, in plain words, before anyone
// signs in. Static and server-rendered, so it costs a stranger nothing.
export function Landing() {
  return (
    <PublicShell>
      <section className="mkt-hero">
        <h1>One calm daily brief for your money, health and routines.</h1>
        <p className="mkt-hero-sub">
          Orbis pulls your finances, health and daily habits into one quiet page you check once a day
          — instead of five apps you keep checking all day.
        </p>
        <div className="mkt-cta">
          <Link href="/login" className="primary">Create account</Link>
          <Link href="/waitlist" className="link">or join the waitlist</Link>
        </div>
      </section>

      <div className="mkt-list">
        <article className="mkt-list-item">
          <h2>One daily brief</h2>
          <p>What changed in your money, health and routines — nothing to dig for.</p>
        </article>
        <article className="mkt-list-item">
          <h2>Money, in one place</h2>
          <p>Spending and broker holdings together, without access to move money.</p>
        </article>
        <article className="mkt-list-item">
          <h2>Health &amp; routines</h2>
          <p>Steps, journal and daily habits, tracked without becoming a chore.</p>
        </article>
      </div>

      <section className="mkt-note" aria-labelledby="mkt-privacy-heading">
        <h2 id="mkt-privacy-heading">AI never trains on your data</h2>
        <p>
          Anything touching your finances, health or notes only goes to providers whose models aren’t trained on it.{' '}
          <Link href="/privacy">Privacy Policy</Link>
        </p>
      </section>
    </PublicShell>
  );
}
