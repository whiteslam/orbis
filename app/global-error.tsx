'use client';

import { useEffect } from 'react';
import { BoundaryScreen } from '@/components/field/boundary';
import './styles/01-base.css';
import './styles/02-home.css';
import './styles/03-hero.css';
import './styles/04-views.css';
import './styles/05-profile.css';
import './styles/06-finance.css';
import './styles/07-auth.css';
import './styles/08-month.css';
import './styles/09-boundaries.css';
import './styles/10-assistant.css';
import './styles/atlas-health.css';
import './styles/atlas-profile.css';
import './styles/atlas-social.css';
import './styles/marketing.css';

// Replaces the root layout when that fails, so it brings its own document and
// styles. No inline script: the stored theme is applied after mount instead
// (the Content-Security-Policy only runs scripts carrying the layout's nonce,
// which this page doesn't have). Until then it follows the system setting.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    try {
      const theme = localStorage.getItem('orbis-theme');
      if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    } catch {
      // Storage can be unavailable; the system theme stands.
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <title>Something went wrong — Orbis</title>
        <BoundaryScreen
          onRetry={retry}
          home={
            // A full page load rather than a client navigation: the app's own layout is what failed.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a className="fd-button ghost" href="/">Go to Home</a>
          }
        />
      </body>
    </html>
  );
}
