import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { LEGAL_UPDATED, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms for using ${SITE_NAME}: who can use it, what it is and is not, and who is responsible for what.`,
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <h1>Terms of Service</h1>
        <p className="mkt-legal-updated"><strong>Draft: pending owner review</strong></p>
        <p className="mkt-legal-updated">Last updated {LEGAL_UPDATED}</p>
      </div>

      <div className="mkt-legal-body">
        <p>
          By using {SITE_NAME}, you agree to these terms. They are written in plain language and are not legal advice.
          How we handle your data is in the <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h2>Who can use {SITE_NAME}</h2>
        <p>
          You must be 18 or older. {SITE_NAME} is built for people in India first. Its defaults are India’s time zone,
          the rupee and Indian English, and you can change them in Settings. You need to give us accurate details to
          sign up, and one person should hold one account.
        </p>

        <h2>Private beta</h2>
        <p>
          {SITE_NAME} is in private beta. Accounts are opened in small batches from a waitlist. Features can change,
          move or be removed, and some are limited by daily allowances that depend on your plan. We may change these
          allowances.
        </p>

        <h2>Not financial, medical, tax or legal advice</h2>
        <p>
          Anything {SITE_NAME} shows or generates is informational only. That includes AI answers, plans and
          observations, and tools such as Money’s portfolio suggestions, the Research desk where it is available, and
          Health plans built from your documents. None of it is financial, investment, medical, tax or legal advice.
          AI can be wrong or out of date. Do not use it as a substitute for a qualified professional, such as a
          registered adviser or a doctor, and check anything important yourself before you act on it.
        </p>

        <h2>Connections</h2>
        <p>
          Third-party connections (Gmail, Zerodha, Groww) are read-only by default. {SITE_NAME} never edits or
          deletes anything in an account you connect; it reads what it needs to show you a summary.
        </p>
        <p>
          Two exceptions need you to switch them on. One is sending from Gmail for Career, after you press “Allow
          sending applications”. Then {SITE_NAME} sends, from your own account, only a job application, follow-up or
          reply you approved by pressing Send on it. It never sends anything on its own. The other is publishing to
          Instagram or Threads, after you connect them: it publishes only posts you choose to publish.
        </p>
        <p>You can disconnect any of them at any time.</p>

        <h2>Your account and credentials</h2>
        <p>
          You are responsible for keeping your {SITE_NAME} credentials, passkeys and device PIN private, and for
          anything done through your account. Tell us right away, {' '}
          <Link href="/support">through the support page</Link>, if you suspect unauthorised access.
        </p>

        <h2>Your content</h2>
        <p>
          What you add stays yours. You give us permission to store it and process it, with the providers named in the
          Privacy Policy, only to run {SITE_NAME} for you. Only add data you have the right to use.
        </p>

        <h2>What you must not do</h2>
        <ul>
          <li>Break the law, or use {SITE_NAME} to harm, harass or deceive anyone.</li>
          <li>Try to read another person’s data, or get around the sign-in, the app lock or the limits.</li>
          <li>Probe, overload or attack the service, or scrape it with automated tools.</li>
          <li>Upload files or content that you have no right to share, or that contain malicious code.</li>
          <li>Use the AI features to produce unlawful or abusive content.</li>
          <li>Resell or share your access to {SITE_NAME}.</li>
        </ul>

        <h2>Availability</h2>
        <p>
          {SITE_NAME} is provided on an as-available basis. Features that depend on third-party providers (AI, market
          data, weather, broker and email connections) may be slow, degraded or unavailable if that provider is.
        </p>

        <h2>Termination</h2>
        <p>
          You can stop using {SITE_NAME} and delete your account at any time from <strong>Settings → Account →
          Delete account</strong>, or the <Link href="/delete-account">delete-account page</Link>. You can export a copy
          of your data first. We may suspend or end access to protect the service or other users, such as for abuse
          or a security risk.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by law, {SITE_NAME} and its operators are not liable for indirect, incidental or
          consequential damages arising from your use of the service, including decisions made based on information
          it shows you. Nothing here limits any right you have under law that cannot be limited, including your
          rights over your personal data.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms as {SITE_NAME} changes. The date above shows the latest version. If you keep
          using {SITE_NAME} after a change, you accept the new terms.
        </p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of India, and any dispute is subject to the jurisdiction of Indian courts.</p>
      </div>
    </PublicShell>
  );
}
