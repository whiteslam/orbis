'use client';

import { useEffect } from 'react';
import { PublicBoundary } from '@/components/marketing/public-boundary';

// Catches a failed render on a public page. The message stays generic: in
// production a server error arrives here as a digest only.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <PublicBoundary onRetry={retry} />;
}
