import Link from 'next/link';
import { HeartPulse, Sparkles, Wallet } from 'lucide-react';
import { PublicShell } from '@/components/marketing/public-shell';

// The signed-out home page: what Orbis is, in plain words, before anyone
// signs in. Static and server-rendered, so it costs a stranger nothing.
export function Landing() {
  return (
    <PublicShell>
      <section className="mkt-hero">
        <p className="mkt-eyebrow">Orbis</p>
        <h1>One calm daily brief for your money, health and routines.</h1>
        <p className="mkt-hero-sub">
          Orbis pulls your finances, health and daily habits into one quiet page you check once a day
          — instead of five apps you keep checking all day.
        </p>
        <div className="mkt-cta">
          <Link href="/login" className="primary">Sign in</Link>
          <Link href="/login" className="ghost">Create account</Link>
        </div>
      </section>

      <div className="mkt-features">
        <article className="mkt-feature">
          <div className="mkt-feature-icon"><Sparkles size={19} aria-hidden="true" /></div>
          <div>
            <h2>One daily brief</h2>
            <p>A single page each morning: what changed in your money, your health and your routines, with nothing to dig for.</p>
          </div>
        </article>
        <article className="mkt-feature">
          <div className="mkt-feature-icon"><Wallet size={19} aria-hidden="true" /></div>
          <div>
            <h2>Money, in one place</h2>
            <p>Transaction alerts from a read-only Gmail connection and your broker holdings, brought together without giving up access to move money.</p>
          </div>
        </article>
        <article className="mkt-feature">
          <div className="mkt-feature-icon"><HeartPulse size={19} aria-hidden="true" /></div>
          <div>
            <h2>Health &amp; routines</h2>
            <p>Steps, health documents, journal entries and the daily habits you want to keep, tracked without turning into another chore.</p>
          </div>
        </article>
      </div>

      <section className="mkt-privacy" aria-labelledby="mkt-privacy-heading">
        <h2 id="mkt-privacy-heading">AI never trains on your data</h2>
        <p>
          When Orbis calls an AI model on your behalf, it routes personal requests only to providers whose models are
          not used for training. General, non-personal requests may use a wider set of providers, but anything that
          touches your finances, health or notes always stays on the no-training path.
        </p>
        <p>
          Read the full picture in the <Link href="/privacy">Privacy Policy</Link>, including which processors we use
          and how to delete your account.
        </p>
      </section>
    </PublicShell>
  );
}
