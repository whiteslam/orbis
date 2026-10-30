// The failure and waiting states for the public pages.
//
// The app's boundary (components/field/boundary.tsx) is styled by the app's
// stylesheets, which no longer load out here — so these are written in the
// marketing classes instead. Keeping them separate is also what stops the app's
// component tree, and the service names inside it, being bundled into every
// public page.

import { OrbisMark } from '@/components/brand/orbis-mark';

export function PublicBoundary({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  return (
    <div className="wl-shell">
      <main className="wl-main">
        <section className="wl-hero">
          <h1>Something went wrong.</h1>
          <p className="wl-lede">This page didn’t load. Nothing was lost. Try again in a moment.</p>
          <div className="wl-boundary-act">
            {onRetry && <button type="button" className="wl-submit" onClick={onRetry}>Try again</button>}
            {/* A real navigation, not a client route change: whatever failed may be the router itself. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="wl-text-button" href="/">Go back</a>
          </div>
        </section>
      </main>
    </div>
  );
}

export function PublicLoading() {
  return (
    <div className="wl-shell">
      <main className="wl-main" aria-busy="true">
        <div className="wl-loading-wrap">
          <OrbisMark size={56} className="wl-loading-ring" />
          <output className="wl-loading">Loading…</output>
        </div>
      </main>
    </div>
  );
}
