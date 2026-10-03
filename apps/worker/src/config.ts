import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['local', 'test', 'development', 'staging', 'production']).default('local'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  DATABASE_URL: z.string().url(),
  JOB_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
  }
  return parsed.data;
}
