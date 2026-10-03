/**
 * Integration tests run against real PostgreSQL and Redis (spec §15).
 * Defaults match docker-compose; override with TEST_DATABASE_URL /
 * TEST_REDIS_URL in CI.
 */
export function integrationEnv() {
  const base =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://kofclub:kofclub_local_only@localhost:5432/kofclub?sslmode=disable';
  const dbName = 'kofclub_it_control_api';
  const url = new URL(base);
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  url.pathname = `/${dbName}`;
  return {
    dbName,
    adminUrl: adminUrl.toString(),
    databaseUrl: url.toString(),
    redisUrl: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    gameServicePort: Number(process.env.TEST_GAME_SERVICE_PORT ?? 4291),
    // Test-only shared secret between control-api and the spawned game-service.
    internalToken: 'integration-test-internal-service-token-0123456789',
  };
}
