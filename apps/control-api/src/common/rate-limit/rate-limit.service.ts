import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';
import { MetricsService } from '../../metrics/metrics.service';
import { MemoryRateLimiter } from './memory-limiter';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

// INCR + set TTL on first hit, atomically.
const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

/**
 * Fixed-window counters in Redis keyed by bucket + dimension. Redis is a
 * degradable dependency (ADR-005): when it is unavailable requests are
 * allowed and the degradation is logged and counted, except for buckets with
 * a memory fallback (credential endpoints), which are then counted per
 * process.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly memory = new MemoryRateLimiter();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  async hit(
    bucket: string,
    subject: string,
    limit: number,
    windowSec: number,
    memoryFallback = false,
  ): Promise<RateLimitResult> {
    const key = `rl:${bucket}:${subject}`;
    try {
      const [count, ttl] = (await this.redis.eval(SCRIPT, 1, key, windowSec)) as [number, number];
      const allowed = count <= limit;
      if (!allowed) this.metrics.securityEvents.inc({ type: 'rate_limited' });
      return { allowed, remaining: Math.max(0, limit - count), retryAfterSec: Math.max(1, ttl) };
    } catch (err) {
      this.metrics.securityEvents.inc({ type: 'rate_limit_degraded' });
      if (memoryFallback) {
        this.logger.warn(
          { err: (err as Error).message, bucket },
          'rate limiter unavailable; limiting in process memory',
        );
        const result = this.memory.hit(key, limit, windowSec);
        if (!result.allowed) this.metrics.securityEvents.inc({ type: 'rate_limited' });
        return result;
      }
      this.logger.warn(
        { err: (err as Error).message, bucket },
        'rate limiter unavailable; allowing request',
      );
      return { allowed: true, remaining: limit, retryAfterSec: 0 };
    }
  }
}
