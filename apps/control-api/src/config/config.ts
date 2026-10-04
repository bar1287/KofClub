import { z } from 'zod';

/**
 * Environment schema. The service refuses to start when configuration is
 * missing or malformed (no silent defaults for secrets).
 */
const envSchema = z.object({
  APP_ENV: z.enum(['local', 'test', 'development', 'staging', 'production']).default('local'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CONTROL_API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  DRAIN_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(2000),
  AUTH_JWT_PRIVATE_KEY_B64: z.string().min(1, 'required (run scripts/init-env.sh)'),
  AUTH_JWT_PUBLIC_KEY_B64: z.string().min(1, 'required (run scripts/init-env.sh)'),
  AUTH_JWT_ISSUER: z.string().min(1).default('kofclub-control-api'),
  AUTH_JWT_AUDIENCE: z.string().min(1).default('kofclub'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(90 * 24 * 3600)
    .default(30 * 24 * 3600),
  IP_HASH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** AES-256-GCM key (32 bytes, base64) for TOTP secrets at rest (ADR-017). */
  MFA_ENCRYPTION_KEY_B64: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'must be 32 random bytes, base64 (run scripts/init-env.sh)',
    ),
  /** Platform-admin routes require a session verified with a second factor. */
  ADMIN_MFA_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Argon2id memory cost in KiB (OWASP baseline 19 MiB). Lowered only in tests. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  GAME_SERVICE_URL: z.string().url().default('http://localhost:4200'),
  INTERNAL_SERVICE_TOKEN: z
    .string()
    .min(32, 'must be at least 32 characters (run scripts/init-env.sh)'),
  GAME_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  /**
   * Which reverse proxies may set X-Forwarded-For (Express "trust proxy"):
   * a hop count ("1" behind one load balancer), or comma-separated
   * addresses/CIDRs/presets ("loopback", "10.0.0.0/8"). Client IPs feed
   * per-IP rate limits and audit hashes, so this must match the deployment.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .default('loopback')
    .transform((v): number | string => (/^\d+$/.test(v) ? Number(v) : v)),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema
    .superRefine((cfg, ctx) => {
      if (cfg.APP_ENV === 'production' && cfg.ARGON2_MEMORY_KIB < 19456) {
        ctx.addIssue({
          code: 'custom',
          path: ['ARGON2_MEMORY_KIB'],
          message: 'must be >= 19456 in production',
        });
      }
      if (cfg.TRUST_PROXY === 'true' || cfg.TRUST_PROXY === '*') {
        // Trusting every hop lets any client spoof its IP via X-Forwarded-For.
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY'],
          message: 'must name hops or proxy addresses, not trust everything',
        });
      }
      if (cfg.APP_ENV === 'production' && !cfg.ADMIN_MFA_REQUIRED) {
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN_MFA_REQUIRED'],
          message: 'cannot be disabled in production',
        });
      }
      if (cfg.APP_ENV === 'production' && !cfg.RATE_LIMIT_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['RATE_LIMIT_ENABLED'],
          message: 'cannot be disabled in production',
        });
      }
    })
    .safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
