import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { REDIS } from '../../infra/redis/redis.module';

/**
 * Publishes revoked session ids to Redis so the realtime gateway can drop
 * connections without a database round trip. Entries live as long as an
 * access token could (after that, tokens expire on their own). PostgreSQL
 * remains the source of truth; control-api checks the database directly.
 */
@Injectable()
export class SessionRevocationPublisher {
  private readonly logger = new Logger(SessionRevocationPublisher.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async publish(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const sid of sessionIds) {
        pipeline.set(`session:revoked:${sid}`, '1', 'EX', this.config.ACCESS_TOKEN_TTL_SECONDS);
        pipeline.publish('session:revoked', sid);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, count: sessionIds.length },
        'session revocation cache unavailable; gateway relies on token expiry',
      );
    }
  }
}
