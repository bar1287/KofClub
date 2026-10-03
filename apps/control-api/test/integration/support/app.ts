import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { createApp } from '../../../src/app.factory';
import { AppConfig, loadConfig } from '../../../src/config/config';
import { integrationEnv } from './env';

export interface TestContext {
  app: INestApplication;
  config: AppConfig;
  close(): Promise<void>;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const env = integrationEnv();
  return loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: env.databaseUrl,
    REDIS_URL: env.redisUrl,
    DRAIN_DELAY_MS: '0',
    ...overrides,
  });
}

export async function startTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const config = testConfig(overrides);
  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
  const app = await createApp(config);
  await app.init();
  return { app, config, close: () => app.close() };
}
