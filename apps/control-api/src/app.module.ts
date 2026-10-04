import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AppErrorFilter } from './common/errors/error.filter';
import { LoggingModule } from './common/logging/logger.module';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { MetricsModule } from './metrics/metrics.module';
import { AuditModule } from './modules/audit/audit.module';
import { ClubsModule } from './modules/clubs/clubs.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminModule } from './modules/admin/admin.module';
import { HistoryModule } from './modules/history/history.module';
import { InternalModule } from './modules/internal/internal.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RiskModule } from './modules/risk/risk.module';
import { TablesModule } from './modules/tables/tables.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';

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
        CommonModule,
        HealthModule,
        AuditModule,
        RiskModule,
        IdentityModule,
        ClubsModule,
        LedgerModule,
        TablesModule,
        TournamentsModule,
        HistoryModule,
        AdminModule,
        InternalModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
    };
  }
}
