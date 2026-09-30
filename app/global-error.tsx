'use client';

import { useEffect } from 'react';
import { PublicBoundary } from '@/components/marketing/public-boundary';
import './styles/01-base.css';
import './styles/marketing.css';

// Replaces the root layout when that fails, so it brings its own document and
// styles. Two stylesheets only: it is reached from public and private pages
// alike, and the app's sheets name the services Orbis connects to, which is not
// something an error page should hand to a stranger. No inline script either —
// the stored theme is applied after mount instead, because the
// Content-Security-Policy only runs scripts carrying the layout's nonce and this
// page has no layout. Until then it follows the system setting.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('orbis-theme');
      if (stored === 'dark' || stored === 'light') document.documentElement.dataset.theme = stored;
    } catch {
      // A blocked or empty localStorage just means the system setting stands.
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <title>Something went wrong — Orbis</title>
        <PublicBoundary onRetry={retry} />
      </body>
    </html>
  );
}
