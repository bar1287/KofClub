import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppErrorFilter } from './common/errors/error.filter';
import { LoggingModule } from './common/logging/logger.module';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule.forRoot(config),
        DatabaseModule,
        RedisModule,
        MetricsModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
    };
  }
}
