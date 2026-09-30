import { PublicLoading } from '@/components/marketing/public-boundary';

// The waiting state for the public pages. The app's own is in
// app/(orbis)/loading.tsx, styled by the app's stylesheets.
export default function Loading() {
  return <PublicLoading />;
}
