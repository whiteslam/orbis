import type { Metadata } from 'next';
import { WaitlistScreen } from '@/components/marketing/waitlist-screen';
import { SITE_NAME } from '@/lib/site';

// The same front door under the name people will be given in a link. It points
// its canonical at '/', so the two addresses are one page as far as search is
// concerned rather than two competing copies.
export const metadata: Metadata = {
  title: 'Join the waitlist',
  description: `${SITE_NAME} is opening in small batches. Leave your email and we’ll send your invite.`,
  alternates: { canonical: '/' },
};

export default function WaitlistPage() {
  return <WaitlistScreen />;
}
