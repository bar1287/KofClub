import { createServer } from 'node:http';
import { Pool } from 'pg';
import pino from 'pino';
import { loadConfig } from './config';
import { Job, runJobs } from './jobs';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    base: { service: 'worker', env: config.APP_ENV },
    messageKey: 'msg',
  });
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 4,
    application_name: 'worker',
  });
  let draining = false;

  // Jobs are registered here as milestones add them (see docs/architecture.md).
  const jobs: Job[] = [];

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health/live') {
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/health/ready') {
      let postgres = 'ok';
      try {
        await pool.query('SELECT 1');
      } catch (err) {
        postgres = `fail: ${(err as Error).message}`;
      }
      const ok = postgres === 'ok' && !draining;
      res.statusCode = ok ? 200 : 503;
      res.end(
        JSON.stringify({
          status: draining ? 'draining' : ok ? 'ok' : 'unavailable',
          service: 'worker',
          checks: { postgres },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: '' } }),
    );
  });
  server.listen(config.WORKER_PORT, () =>
    logger.info({ port: config.WORKER_PORT }, 'service_listening'),
  );

  const timer = setInterval(() => {
    void runJobs(jobs, logger);
  }, config.JOB_INTERVAL_MS);

  const shutdown = () => {
    draining = true;
    clearInterval(timer);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('worker failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
