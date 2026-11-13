import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// One origin for the browser: `/v1/*` reaches the API (Caddy already does this in production).
const api = { '/v1': { target: process.env.API_PROXY_URL ?? 'http://localhost:3001' } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits for the person to accept it (see UpdatePrompt): a silent reload could
      // interrupt an ordering session.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'Línea de vida',
        short_name: 'Línea de vida',
        description:
          'Un espacio privado para recorrer tus fotografías y recuerdos familiares en el tiempo.',
        lang: 'es',
        start_url: '/timeline',
        scope: '/',
        display: 'standalone',
        background_color: '#05070d',
        theme_color: '#05070d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only the app shell is cached. The archive is private: `/v1` (API, photos, downloads) is
        // never cached nor answered by the service worker, so nothing outlives the session.
        // Of the fonts, only the Latin subset ships in the shell; the rest load on demand.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}', '**/*-latin-wght-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/v1\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 3000, strictPort: true, proxy: api },
  preview: { port: 3000, strictPort: true, proxy: api },
  test: {
    css: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
