import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A self-contained server for the production image (only the files it needs, no devDependencies).
  output: 'standalone',
  // Trace from the workspace root so files of other packages are included.
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
};
export default nextConfig;
