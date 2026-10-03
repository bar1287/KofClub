import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type PlatformRole = 'USER' | 'PLATFORM_ADMIN';

export interface AuthContext {
  userId: string;
  sessionId: string;
  platformRole: PlatformRole;
}

/** Per-request metadata used for audit/security records. */
export interface RequestContext {
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
  auth?: AuthContext;
}

export interface AppRequest extends Request {
  ctx?: RequestContext;
  auth?: AuthContext;
}

/** Injects the RequestContext built by RequestContextMiddleware. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  const base = req.ctx ?? { requestId: String(req.id ?? ''), ipHash: null, userAgent: null };
  return { ...base, auth: req.auth };
});

/** Injects the authenticated principal (guaranteed by AuthGuard). */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw new Error('CurrentAuth used on a public route');
    return req.auth;
  },
);
