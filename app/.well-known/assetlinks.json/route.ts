import { assetLinks } from '@/lib/native/assetlinks';

// Digital Asset Links: ties the Android app to this site for app links and for
// passkeys inside its WebView. Served as [] until ANDROID_APP_ID and
// ANDROID_CERT_SHA256 are set.
export async function GET() {
  return new Response(JSON.stringify(assetLinks(process.env.ANDROID_APP_ID, process.env.ANDROID_CERT_SHA256)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}
