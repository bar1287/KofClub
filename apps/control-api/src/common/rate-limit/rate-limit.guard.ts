import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { sha256Hex } from '../crypto';
import { AppError } from '../errors/app-error';
import type { AppRequest } from '../request-context';
import { SKIP_RATE_LIMIT } from './no-rate-limit.decorator';
import { DEFAULT_RULE, RATE_LIMIT_RULES, RateLimitRule } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

/**
 * Enforces rate limits on IP, account and endpoint dimensions (spec §9).
 * Runs after AuthGuard so authenticated requests are keyed by user.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const route = `${req.method}:${(req.route?.path as string | undefined) ?? req.path}`;
    const extra =
      this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const rules: RateLimitRule[] = [
      { ...DEFAULT_RULE, name: `default:${route}`, by: req.auth ? 'user' : 'ip' },
      ...extra,
    ];
    for (const rule of rules) {
      const subject = this.subjectFor(rule, req);
      if (subject === null) continue;
      const result = await this.limiter.hit(
        rule.name,
        subject,
        rule.limit,
        rule.windowSec,
        rule.memoryFallback,
      );
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        throw new AppError('RATE_LIMITED', 'Too many requests', {
          retryAfterSec: result.retryAfterSec,
        });
      }
    }
    return true;
  }

  private subjectFor(rule: RateLimitRule, req: AppRequest): string | null {
    if (rule.by === 'ip') return req.ctx?.ipHash ?? 'unknown';
    if (rule.by === 'user') return req.auth?.userId ?? req.ctx?.ipHash ?? 'unknown';
    const raw = (req.body as Record<string, unknown> | undefined)?.[rule.by.body];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    // Hash account identifiers so emails never appear in Redis keys.
    return sha256Hex(raw.trim().toLowerCase()).slice(0, 32);
  }
}
