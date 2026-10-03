import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { constantTimeEqual } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/config';

/** Accepts only callers presenting the shared internal service token. */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !constantTimeEqual(token, this.config.INTERNAL_SERVICE_TOKEN)) {
      throw new AppError('AUTH_REQUIRED', 'Service token required');
    }
    return true;
  }
}
