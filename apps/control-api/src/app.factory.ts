import 'reflect-metadata';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config';

/** Builds the Nest application (shared by main.ts and integration tests). */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // Real client IPs (rate limits, audit hashes) come from X-Forwarded-For
  // only when set by a trusted proxy (TRUST_PROXY).
  app.set('trust proxy', config.TRUST_PROXY);
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
      // Service-to-service API: /internal/v1/... (not routed by the edge).
      { path: 'internal/{*rest}', method: RequestMethod.ALL },
    ],
  });
  return app;
}
