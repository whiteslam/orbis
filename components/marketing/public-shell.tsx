import type { ReactNode } from 'react';
import Link from 'next/link';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { SITE_NAME } from '@/lib/site';

// The shared frame for every signed-out page: landing, privacy, terms,
// support, delete-account, and (Task 10) the offline page. Full-bleed on
// the Field ground rather than the phone-frame shell, since there is no
// account yet to frame.
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="mkt-shell">
      <header className="mkt-header">
        <Link href="/" className="mkt-brand">
          <OrbisMark size={30} />
          <strong>{SITE_NAME}</strong>
        </Link>
        <Link href="/login" className="mkt-signin">Sign in</Link>
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
