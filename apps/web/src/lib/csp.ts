/** Origin of an absolute URL (scheme://host:port), or null when invalid. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin.replace(/^http/, url.startsWith('ws') ? 'ws' : 'http');
  } catch {
    return null;
  }
}

export interface CspOptions {
  nonce: string;
  apiUrl: string;
  realtimeUrl: string;
  /** next dev needs eval (React refresh) and its HMR socket. */
  dev: boolean;
  /**
   * The Telegram Mini App is enabled: Telegram Web (web.telegram.org) shows
   * the app in a frame, so that origin may frame it (ADR-018). The mobile and
   * desktop Telegram apps use a web view and need no framing.
   */
  telegramFraming?: boolean;
}

/** Origins allowed to frame the app when the Telegram Mini App is on. */
export const TELEGRAM_FRAME_ANCESTORS = ['https://web.telegram.org'];

/**
 * Content-Security-Policy for every page. Scripts run only with the
 * per-request nonce ('strict-dynamic' lets Next's nonce-bearing loader pull
 * its chunks); network access is limited to this origin, the control API
 * and the realtime gateway; the app cannot be framed (except by Telegram Web
 * when the Mini App is on).
 */
export function buildCsp({
  nonce,
  apiUrl,
  realtimeUrl,
  dev,
  telegramFraming = false,
}: CspOptions): string {
  const connect = new Set(["'self'"]);
  for (const url of [apiUrl, realtimeUrl]) {
    const origin = originOf(url);
    if (origin) connect.add(origin);
  }
  if (dev) connect.add('ws:');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // React style attributes and Next's injected styles need inline styles.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...connect],
    'frame-ancestors': telegramFraming ? ["'self'", ...TELEGRAM_FRAME_ANCESTORS] : ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** 128-bit random nonce, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
