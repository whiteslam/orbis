'use client';

import { useEffect } from 'react';
import { BoundaryScreen } from '@/components/field/boundary';
import './globals.css';

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
