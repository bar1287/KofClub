import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.httpDuration.startTimer();
    res.on('finish', () => {
      // Use the matched route pattern (not the raw URL) to bound cardinality.
      const route = (req.route?.path as string | undefined)
        ? `${req.baseUrl}${req.route.path as string}`
        : 'unmatched';
      this.metrics.httpRequests.inc({ route, method: req.method, code: String(res.statusCode) });
      end({ route, method: req.method });
    });
    next();
  }
}
