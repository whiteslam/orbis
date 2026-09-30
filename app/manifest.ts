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
    // Matches app/layout.tsx's light `themeColor`; the dark one only applies
    // via the media-query variant the manifest spec doesn't support.
    background_color: '#f2f2f7',
    theme_color: '#f2f2f7',
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
