import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../../common/auth/public.decorator';
import { TokenService } from '../../common/auth/token.service';
import { AppError } from '../../common/errors/app-error';
import type { AppRequest } from '../../common/request-context';
import { SessionsRepository } from './sessions.repository';

/**
 * Global guard: every route requires a valid access token unless marked
 * @Public(). Besides the signature/expiry check, the session must not be
 * revoked and the account must be active (checked against PostgreSQL, the
 * source of truth), so logout/ban take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new AppError('AUTH_REQUIRED', 'Authentication required');

    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    const state = await this.sessions.authState(claims.sessionId, claims.userId);
    if (!state || state.sessionExpired)
      throw new AppError('AUTH_TOKEN_INVALID', 'Session not found');
    if (state.sessionRevoked)
      throw new AppError('AUTH_SESSION_REVOKED', 'Session has been revoked');
    if (state.userStatus !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active');

    // Role comes from the database, not the token, so demotions apply at once.
    req.auth = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      platformRole: state.platformRole,
      mfa: state.mfa,
    };
    return true;
  }
}
