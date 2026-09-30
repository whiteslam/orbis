'use client';

import { useEffect } from 'react';
import { BoundaryScreen } from '@/components/field/boundary';

// Catches a failed render anywhere inside Orbis. The message stays generic: in
// production a server error arrives here as a digest only.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // A plain anchor rather than <Link>: the proxy is what turns '/' into the app
  // for a signed-in visitor, and it only sees a real navigation.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  const home = <a className="fd-button ghost" href="/">Go to Home</a>;

  return <BoundaryScreen onRetry={retry} home={home} />;
}
