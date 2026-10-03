// Must stay the first import: tracing instruments modules as they load.
import { tracing } from './tracing';
import { createApp } from './app.factory';
import { loadConfig } from './config/config';
import { HealthService } from './health/health.service';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.CONTROL_API_PORT);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Report "draining" so load balancers stop routing before we close.
    app.get(HealthService).setDraining(true);
    console.warn(`control-api: ${signal} received, draining for ${config.DRAIN_DELAY_MS}ms`);
    await new Promise((r) => setTimeout(r, config.DRAIN_DELAY_MS));
    await app.close();
    await tracing?.shutdown().catch(() => undefined); // flush pending spans
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  console.error('control-api failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
