import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The production image sets NEXT_OUTPUT=standalone for a self-contained server. It stays off by
  // default because Windows cannot create the symlinks that output needs.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Trace from the workspace root so files of other packages are included.
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  // One origin for the browser: `/v1/*` reaches the API (Caddy already does this in production).
  async rewrites() {
    const target = process.env.API_PROXY_URL ?? 'http://localhost:3001';
    return [{ source: '/v1/:path*', destination: `${target}/v1/:path*` }];
  },
};
export default nextConfig;
