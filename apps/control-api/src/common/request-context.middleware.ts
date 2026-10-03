import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/config';
import { hmacHex } from './crypto';
import { resolveRequestId } from './http/request-id';
import type { AppRequest } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    const ip = req.ip ?? req.socket.remoteAddress ?? null;
    const ua = req.headers['user-agent'];
    req.ctx = {
      requestId: resolveRequestId(req, res),
      // Raw IPs are never stored; a keyed hash still allows correlation.
      ipHash: ip ? hmacHex(this.config.IP_HASH_SECRET, ip) : null,
      userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    };
    next();
  }
}
