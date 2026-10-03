import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Database } from './database';

// Return BIGINT (int8) columns as JS strings converted to BigInt-safe numbers
// only where callers opt in; by default keep them as strings to avoid
// silent precision loss for chip amounts (see docs/ledger.md).
types.setTypeParser(types.builtins.INT8, (v) => v);

@Global()
@Module({
  providers: [
    {
      provide: Database,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Database(
          new Pool({
            connectionString: config.DATABASE_URL,
            max: config.DATABASE_POOL_MAX,
            application_name: 'control-api',
            statement_timeout: 10_000,
          }),
        ),
    },
  ],
  exports: [Database],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.pool.end();
  }
}
