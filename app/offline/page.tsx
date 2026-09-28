import type { Metadata } from 'next';
import { PublicShell } from '@/components/marketing/public-shell';

// Precached by public/sw.js and served for any navigation the network can't
// complete. Static, no data fetching — it has to render with nothing.
export const metadata: Metadata = {
  title: 'You’re offline',
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <p className="mkt-eyebrow">Offline</p>
        <h1>You’re offline</h1>
        <p>Orbis will pick up where you left off when you’re back.</p>
      </div>
    </PublicShell>
  );
}
