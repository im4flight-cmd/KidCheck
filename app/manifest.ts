import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CFC Classroom Check-In',
    short_name: 'CFC Check-In',
    description: 'Live per-classroom check-in roster for Country Faith Church.',
    start_url: '/',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#0f1c31',
    theme_color: '#0f1c31',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
