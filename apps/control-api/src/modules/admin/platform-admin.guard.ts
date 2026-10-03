import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AppRequest } from '../../common/request-context';

/**
 * Platform-administration routes. Runs after the global AuthGuard, which
 * loads the platform role from PostgreSQL on every request (never from the
 * token), so a revoked admin role takes effect immediately.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (req.auth?.platformRole !== 'PLATFORM_ADMIN') {
      throw new AppError('FORBIDDEN', 'Platform administrators only');
    }
    return true;
  }
}
