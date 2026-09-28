import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { SITE_NAME, supportEmail } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Support',
  description: `Get help with ${SITE_NAME}, including how to delete your account.`,
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  const email = supportEmail();

  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <p className="mkt-eyebrow">Help</p>
        <h1>Support</h1>
      </div>

      <div className="mkt-legal-body">
        {email ? (
          <p>
            Write to us at <a href={`mailto:${email}`}>{email}</a> and we will get back to you. Include your account
            email so we can find your account.
          </p>
        ) : (
          <p>
            A direct support address is coming soon. In the meantime, the most common questions are answered below.
          </p>
        )}

        <h2>How do I delete my account?</h2>
        <p>
          Sign in, then go to <strong>Profile → Settings → Account → Delete account</strong>, or open the {' '}
          <Link href="/delete-account">delete-account page</Link> for details on what gets removed. If you cannot
          sign in, {email ? <>email <a href={`mailto:${email}`}>{email}</a></> : 'use the address above once it is available'}{' '}
          and we will delete it for you.
        </p>

        <h2>Does Orbis ever change or delete anything in the accounts I connect?</h2>
        <p>
          No. Gmail, broker and health connections are all read-only. Orbis only reads transaction and bank/card
          alert emails and read-only holdings; it never sends, edits or deletes anything on your behalf.
        </p>

        <h2>Does the AI train on my data?</h2>
        <p>
          Personal requests — anything touching your finances, health documents, notes or journal — are only sent to
          AI providers flagged as not training on submitted data. See the <Link href="/privacy">Privacy Policy</Link> for details.
        </p>

        <h2>Where can I read the legal details?</h2>
        <p>
          The full picture is in the <Link href="/privacy">Privacy Policy</Link> and the {' '}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </div>
    </PublicShell>
  );
}
