import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { SITE_NAME, supportEmail } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: `How to permanently delete your ${SITE_NAME} account and everything in it.`,
  alternates: { canonical: '/delete-account' },
};

export default function DeleteAccountPage() {
  const email = supportEmail();

  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <p className="mkt-eyebrow">Account</p>
        <h1>Delete your account</h1>
      </div>

      <div className="mkt-legal-body">
        <h2>In the app</h2>
        <p>
          Sign in to {SITE_NAME}, then go to <strong>Settings → Your data → Delete account</strong>. You will be asked to type DELETE,
          and for your password if you haven&apos;t signed in recently, since deletion cannot be undone. You can export
          a copy of your data from the same place first.
        </p>
        <p>
          <Link href="/login">Sign in</Link> to get started.
        </p>

        <h2>What gets deleted</h2>
        <p>Deleting your account permanently removes:</p>
        <ul>
          <li>Your account and sign-in credentials</li>
          <li>Any connected Gmail, broker or health data and the connection itself</li>
          <li>Your journal, notes, voice notes, routines and their history</li>
          <li>Uploaded health documents and saved AI results</li>
          <li>Social posts, drafts and media</li>
          <li>Your profile, fitness persona and notification settings</li>
        </ul>
        <p>Nothing is kept after deletion. It is not recoverable, so make sure it is what you want before confirming.</p>

        <h2>Can&apos;t sign in?</h2>
        <p>
          {email ? (
            <>Email us at <a href={`mailto:${email}`}>{email}</a> from the address on your account and we will delete it for you.</>
          ) : (
            <>Reach us <Link href="/support">through the support page</Link> and we will delete it for you.</>
          )}
        </p>
      </div>
    </PublicShell>
  );
}
