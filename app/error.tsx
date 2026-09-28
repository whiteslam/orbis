'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BoundaryScreen } from '@/components/field/boundary';

// Catches a failed render anywhere below the root layout. The message stays
// generic: in production a server error arrives here as a digest only.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <BoundaryScreen onRetry={retry} home={<Link className="fd-button ghost" href="/">Go to Home</Link>} />;
}
