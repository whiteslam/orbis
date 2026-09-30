import type { Metadata } from 'next';
import { PublicShell } from '@/components/marketing/public-shell';
import { WaitlistForm } from '@/components/marketing/waitlist-form';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description: `${SITE_NAME} is opening in small batches. Leave your email and we’ll send your invite.`,
  alternates: { canonical: '/waitlist' },
};

export default function WaitlistPage() {
  return (
    <PublicShell>
      <WaitlistForm />
    </PublicShell>
  );
}
