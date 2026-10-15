import path from 'node:path';
import type { NextConfig } from 'next';

// Framing is decided per request in proxy.ts (CSP frame-ancestors and
// X-Frame-Options), since the Telegram Mini App needs Telegram Web to frame it.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace dependencies from the monorepo root so the standalone bundle includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@kofclub/ui', '@kofclub/contracts'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
