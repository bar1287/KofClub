import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { createApp } from '../../../src/app.factory';
import { AppConfig, loadConfig } from '../../../src/config/config';
import { integrationEnv } from './env';

export interface TestContext {
  app: INestApplication;
  config: AppConfig;
  /** Direct database access for assertions and test setup only. */
  db: Pool;
  privateKeyPem: string;
  close(): Promise<void>;
}

const keys = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
})();

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const env = integrationEnv();
  return loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: env.databaseUrl,
    REDIS_URL: env.redisUrl,
    DRAIN_DELAY_MS: '0',
    AUTH_JWT_PRIVATE_KEY_B64: Buffer.from(keys.privatePem).toString('base64'),
    AUTH_JWT_PUBLIC_KEY_B64: Buffer.from(keys.publicPem).toString('base64'),
    IP_HASH_SECRET: randomBytes(32).toString('hex'),
    // Cheap hashing keeps the suite fast; production enforces >= 19 MiB.
    ARGON2_MEMORY_KIB: '1024',
    GAME_SERVICE_URL: `http://127.0.0.1:${env.gameServicePort}`,
    INTERNAL_SERVICE_TOKEN: env.internalToken,
    ...overrides,
  });
}

export async function startTestApp(
  overrides: Record<string, string> = {},
  { flushRedis = true } = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  if (flushRedis) {
    const redis = new Redis(config.REDIS_URL);
    await redis.flushdb();
    redis.disconnect();
  }
  const app = await createApp(config);
  await app.init();
  const db = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  return {
    app,
    config,
    db,
    privateKeyPem: keys.privatePem,
    close: async () => {
      await db.end();
      await app.close();
    },
  };
}
