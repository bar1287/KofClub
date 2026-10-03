import type { Request, Response } from 'express';
import type { AppConfig } from '../../config/config';

export const REFRESH_COOKIE = 'kof_rt';
export const AUTH_TRANSPORT_HEADER = 'x-auth-transport';

/**
 * Browser clients send `X-Auth-Transport: cookie` to receive the refresh
 * token in an HttpOnly, SameSite=Strict cookie scoped to /v1/auth instead of
 * the JSON body (keeps it out of reach of injected scripts). Native clients
 * use the body.
 */
export function wantsCookieTransport(req: Request): boolean {
  return req.headers[AUTH_TRANSPORT_HEADER] === 'cookie';
}

export function setRefreshCookie(
  res: Response,
  config: AppConfig,
  token: string,
  expiresAt: string,
): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.APP_ENV !== 'local' && config.APP_ENV !== 'test',
    sameSite: 'strict',
    path: '/v1/auth',
    expires: new Date(expiresAt),
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: config.APP_ENV !== 'local' && config.APP_ENV !== 'test',
    sameSite: 'strict',
    path: '/v1/auth',
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
