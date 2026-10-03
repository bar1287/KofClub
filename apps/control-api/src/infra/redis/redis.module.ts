import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../../config/config';

export const REDIS = Symbol('REDIS');
const CONNECT_WAIT_MS = 3000;

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        const redis = new Redis(config.REDIS_URL, {
          // Fail fast: Redis is a degradable dependency (ADR-005).
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectionName: 'control-api',
        });
        // Give the first connection a bounded chance to come up so the service
        // starts ready; if Redis is down we start degraded and keep retrying.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, CONNECT_WAIT_MS);
          redis.once('ready', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}
