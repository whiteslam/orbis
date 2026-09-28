import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { LEGAL_UPDATED, SITE_NAME, siteUrl, supportEmail } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE_NAME} collects, uses and deletes your data, and which processors it relies on.`,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  const email = supportEmail();
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : <>through the <Link href="/support">support page</Link></>;

  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <p className="mkt-eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="mkt-legal-updated">Last updated {LEGAL_UPDATED}</p>
      </div>

      <div className="mkt-legal-body">
        <p>
          This page explains what {SITE_NAME} collects, why, and how to get it deleted. It is written in plain
          language and is not legal advice.
        </p>

        <h2>What we hold</h2>
        <p>Orbis only holds what you connect, upload or type in. Depending on what you use, that can include:</p>
        <ul>
          <li>Your account email address</li>
          <li>Transaction and bank/card alert emails read from a connected Gmail account (read-only, alerts only — Orbis never sends, edits or deletes anything in Gmail)</li>
          <li>Holdings from a connected broker account (Zerodha or Groww), read-only</li>
          <li>Step counts synced from your device</li>
          <li>Health documents you upload for a preview and AI-grounded observations</li>
          <li>Journal entries, notes, voice notes and the routines you set up</li>
          <li>Social posts and media you draft in the Social tab</li>
          <li>An approximate location, used only to show local weather</li>
          <li>A push notification token, if you turn notifications on</li>
        </ul>

        <h2>Who we share it with</h2>
        <p>Orbis is built on top of a small set of processors, each used for one job:</p>
        <ul>
          <li><strong>Supabase</strong> — hosts your account, your data and file storage</li>
          <li><strong>Vercel</strong> — hosts and runs the application</li>
          <li><strong>Google</strong> — Gmail (read-only transaction and bank/card alerts) and Calendar, only if you connect them</li>
          <li><strong>Zerodha</strong> and <strong>Groww</strong> — read-only broker holdings, only if you connect them</li>
          <li><strong>Groq, Google Gemini, Mistral and OpenRouter</strong> — the AI providers behind Orbis&apos;s AI features, chosen automatically by a router (see below)</li>
          <li><strong>Open-Meteo</strong> — weather for your approximate location</li>
          <li><strong>Alpha Vantage, AMFI, Frankfurter and CoinGecko</strong> — market, fund, currency and crypto price data</li>
        </ul>
        <p>We do not sell your data, and we do not run ads or tracking pixels on Orbis.</p>

        <h2>The AI no-training rule</h2>
        <p>
          When a request involves anything personal — your finances, health documents, notes or journal — Orbis&apos;s
          AI router only calls providers whose models are flagged as not training on submitted data. General,
          non-personal requests may use a broader set of providers. This rule is enforced in code, not just policy: a
          personal request that only fits a training-capable provider is refused rather than sent.
        </p>

        <h2>Why we keep it, and for how long</h2>
        <p>
          Data is kept for as long as your account exists, so Orbis can show it back to you. Nothing is retained for
          a fixed period beyond that, and nothing is kept after you delete it or your account.
        </p>

        <h2>Deleting your data</h2>
        <p>
          You can delete your account and everything in it at any time from <strong>Profile → Account → Delete
          account</strong> inside the app, or from the <Link href="/delete-account">delete-account page</Link>. If
          you cannot sign in, contact us {contact} and we will delete it for you.
        </p>

        <h2>Children</h2>
        <p>Orbis is not intended for anyone under 18, and we do not knowingly collect data from children.</p>

        <h2>Contact and grievance officer</h2>
        <p>
          For any privacy question, correction request, or a grievance under India&apos;s Digital Personal Data
          Protection Act, reach us {contact}.
        </p>
      </div>

      <p className="mkt-legal-note">
        This policy describes {SITE_NAME} as available at {siteUrl()}. It may change as the product changes; the date
        above always reflects the latest version.
      </p>
    </PublicShell>
  );
}
