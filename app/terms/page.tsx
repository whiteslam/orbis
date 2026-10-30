import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { LEGAL_UPDATED, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms for using ${SITE_NAME}: what it is, what it is not, and who is responsible for what.`,
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <h1>Terms of Service</h1>
        <p className="mkt-legal-updated">Last updated {LEGAL_UPDATED}</p>
      </div>

      <div className="mkt-legal-body">
        <p>By using {SITE_NAME}, you agree to these terms. They are written in plain language and are not legal advice.</p>

        <h2>Not financial, medical or tax advice</h2>
        <p>
          Anything Orbis shows or generates — including AI-produced observations about your finances or health
          documents — is informational only. It is not financial, medical, tax or legal advice, and it should not be
          treated as a substitute for a qualified professional.
        </p>

        <h2>Connections</h2>
        <p>
          Third-party connections (Gmail, brokers, health devices) are read-only by default. Orbis never edits or
          deletes anything in an account you connect; it reads what it needs to show you a summary.
        </p>
        <p>
          The one exception is sending from Gmail for Career, and only if you turn it on with &ldquo;Allow sending
          applications&rdquo;. Then Orbis sends, from your own account, only a job application, follow-up or reply you
          approved by pressing Send on it. It never sends anything on its own.
        </p>

        <h2>Your account and credentials</h2>
        <p>
          You are responsible for keeping your Orbis credentials, passkeys and device PIN private, and for anything
          done through your account. Tell us right away, {' '}
          <Link href="/support">through the support page</Link>, if you suspect unauthorised access.
        </p>

        <h2>Availability</h2>
        <p>
          Orbis is provided on an as-available basis. Features that depend on third-party providers (AI, market
          data, weather, broker and email connections) may be slow, degraded or unavailable if that provider is.
        </p>

        <h2>Termination</h2>
        <p>
          You can stop using Orbis and delete your account at any time from <strong>Settings → Your data → Delete
          account</strong>, or the <Link href="/delete-account">delete-account page</Link>. We may suspend or end
          access to protect the service or other users, such as for abuse or a security risk.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by law, {SITE_NAME} and its operators are not liable for indirect, incidental or
          consequential damages arising from your use of the service, including decisions made based on information
          it shows you.
        </p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of India, and any dispute is subject to the jurisdiction of Indian courts.</p>
      </div>
    </PublicShell>
  );
}
