import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, newNonce } from './src/lib/csp';
import { publicEnv } from './src/lib/env';

const hsts = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';

/**
 * Sets a per-request nonce Content-Security-Policy. Next.js reads the
 * policy from the request headers and stamps its own scripts with the
 * nonce, so pages are rendered per request (see app/layout.tsx).
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: publicEnv.apiUrl,
    realtimeUrl: publicEnv.realtimeUrl,
    dev: process.env.NODE_ENV !== 'production',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', csp);
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  if (hsts) {
    response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  }
  return response;
}

export const config = {
  // Pages only: static assets and health probes need no policy.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health/).*)'],
};
