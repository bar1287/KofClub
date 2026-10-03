import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { integrationEnv } from './env';

/**
 * Creates a fresh, fully migrated database for the integration suite.
 * Migrations are applied by the same Go migrate tool used in every
 * environment (db/migrations is the single source of schema truth).
 */
export default async function globalSetup(): Promise<void> {
  const env = integrationEnv();
  const admin = new Client({ connectionString: env.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${env.dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${env.dbName}`);
  } finally {
    await admin.end();
  }

  const repoRoot = path.resolve(__dirname, '../../../../..');
  const migrateBin = process.env.MIGRATE_BIN;
  const [cmd, args] = migrateBin ? [migrateBin, ['up']] : ['go', ['run', './go/cmd/migrate', 'up']];
  execFileSync(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: env.databaseUrl },
    stdio: 'pipe',
  });
}
