import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One origin for the browser: `/v1/*` reaches the API (Caddy already does this in production).
const api = { '/v1': { target: process.env.API_PROXY_URL ?? 'http://localhost:3001' } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true, proxy: api },
  preview: { port: 3000, strictPort: true, proxy: api },
  test: {
    css: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
