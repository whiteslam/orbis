import type { Metadata } from 'next';
import { WaitlistScreen } from '@/components/marketing/waitlist-screen';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `${SITE_NAME} — join the waitlist`,
  description: `${SITE_NAME} is opening in small batches. Leave your email and we’ll send your invite.`,
  alternates: { canonical: '/' },
};

/**
 * The public front door: the waitlist, for everybody.
 *
 * It reads nothing about who is asking. Whoever holds a session is redirected to
 * the app by the proxy, before this ever renders, which is both why the app's
 * address appears in no public file and why a stranger's visit costs no auth
 * round trip. Nothing client-side links here either — the brand marks are plain
 * anchors — so every arrival at '/' is a real navigation the proxy sees.
 */
export default function Page() {
  return <WaitlistScreen />;
}
