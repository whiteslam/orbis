import type { ReactNode } from 'react';
import Link from 'next/link';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { SITE_NAME } from '@/lib/site';

// The shared frame for the signed-out pages that are not the front door:
// privacy, terms, support, delete-account and offline. Full-bleed on the Field
// ground rather than the phone-frame shell, since there is no account yet to
// frame, and with no sign-in button: nothing a stranger fetches should point at
// the way in.
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="mkt-shell">
      <header className="mkt-header">
        {/* A plain anchor, not <Link>: reaching Orbis from here depends on the
            proxy seeing a real navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mkt-brand">
          <OrbisMark size={30} />
          <strong>{SITE_NAME}</strong>
        </a>
      </header>
      <main className="mkt-main">{children}</main>
      <footer className="mkt-footer">
        <div className="mkt-footer-inner">
          <ul className="mkt-footer-links">
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/support">Support</Link></li>
            <li><Link href="/delete-account">Delete account</Link></li>
          </ul>
          <p className="mkt-footer-copy">&copy; {new Date().getFullYear()} {SITE_NAME}</p>
        </div>
      </footer>
    </div>
  );
}
