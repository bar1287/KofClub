/** Public runtime endpoints (inlined at build time by Next.js). */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:4100/ws',
};

/** Joins a base URL and a path without producing double slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
