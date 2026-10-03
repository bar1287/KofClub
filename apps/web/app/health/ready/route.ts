export const dynamic = 'force-dynamic';

/**
 * The web tier serves static/SSR assets only; it is ready as soon as the
 * Next.js server runs. Backend readiness is reported by each API service.
 */
export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'web' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
