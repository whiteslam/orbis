import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbis',
    short_name: 'Orbis',
    description: 'Your personal operating system',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The brand background, matching app/layout.tsx's themeColor, so an installed
    // app opens on the dark ground instead of flashing a pale splash.
    background_color: '#0e0e10',
    theme_color: '#0e0e10',
    categories: ['finance', 'health', 'productivity', 'lifestyle'],
    // No tab shortcuts: this file is public, and each one would have carried the
    // app's own address. start_url stays '/', which redirects whoever is signed
    // in, so the installed app still opens straight into Orbis.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
