import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Files larger than this go straight to Storage with a signed upload URL;
      // Vercel refuses bodies over ~4.5 MB anyway.
      bodySizeLimit: '4mb',
    },
  },
  // Static security headers. The Content-Security-Policy carries a per-request nonce,
  // so proxy.ts sets it instead.
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self), payment=()' },
      ],
    }];
  },
};

export default nextConfig;
