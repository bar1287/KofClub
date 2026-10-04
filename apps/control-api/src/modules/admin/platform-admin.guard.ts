import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AppRequest } from '../../common/request-context';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { MfaService } from '../identity/mfa/mfa.service';

/**
 * Platform-administration routes. Runs after the global AuthGuard, which
 * loads the platform role and the session's second-factor flag from
 * PostgreSQL on every request (never from the token), so a revoked admin
 * role takes effect immediately. Administrators need a session verified
 * with a second factor (ADR-017); `details.enrolled` tells the client
 * whether to ask for enrollment or for a fresh sign-in with a code.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly mfa: MfaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (auth?.platformRole !== 'PLATFORM_ADMIN') {
      throw new AppError('FORBIDDEN', 'Platform administrators only');
    }
    if (this.config.ADMIN_MFA_REQUIRED && !auth.mfa) {
      throw new AppError(
        'MFA_REQUIRED',
        'Platform administration needs two-factor authentication',
        {
          enrolled: await this.mfa.enrolled(auth.userId),
        },
      );
    }
    return true;
  }
}
