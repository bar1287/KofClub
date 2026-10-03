/**
 * Post-login redirect target: only same-origin absolute paths are followed
 * (no open redirects via `?next=//evil.example` or `?next=https://…`).
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/clubs';
  }
  return next;
}
