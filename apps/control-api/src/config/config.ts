import { z } from 'zod';

/**
 * Environment schema. The service refuses to start when configuration is
 * missing or malformed (no silent defaults for secrets).
 */
/** Unset and empty variables both mean "not configured". */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

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

  // --- Telegram (ADR-018): all optional; set together to enable ---------------
  /** Bot token from BotFather. Secret: never commit it. */
  TELEGRAM_BOT_TOKEN: optionalEnv(
    z.string().regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'must look like 123456:ABC… (from BotFather)'),
  ),
  /** The bot's username without "@" (links such as t.me/<bot>?startapp=…). */
  TELEGRAM_BOT_USERNAME: optionalEnv(
    z.string().regex(/^[A-Za-z0-9_]{5,32}$/, 'must be the bot username without @'),
  ),
  /** Telegram sends it with every webhook call (X-Telegram-Bot-Api-Secret-Token). */
  TELEGRAM_WEBHOOK_SECRET: optionalEnv(
    z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, 'must be 32-256 letters, digits, _ or -'),
  ),
  /** Public URL of the web app, opened as the Mini App (https in production). */
  TELEGRAM_MINI_APP_URL: optionalEnv(z.string().url()),
  /** Where players get help with payments (/paysupport), e.g. @support_user or an email. */
  TELEGRAM_SUPPORT_CONTACT: optionalEnv(z.string().trim().min(3).max(128)),
  TELEGRAM_API_URL: z.string().url().default('https://api.telegram.org'),
  /** How old Mini App init data may be when signing in. */
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),

  // --- Telegram Stars store (T2, ADR-018): digital goods only ----------------
  /** Sell Club Pro, premium themes and tips for Stars (needs the bot). */
  TELEGRAM_STARS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Club Pro, per 30 days, in Stars. */
  STARS_PRICE_CLUB_PRO: z.coerce.number().int().min(1).max(10000).default(250),
  /** Premium felts and card backs, once, in Stars. */
  STARS_PRICE_PREMIUM_THEMES: z.coerce.number().int().min(1).max(10000).default(150),
  // --- Operators (T3, ADR-019): other people's bots on this service ---------
  /** Anyone can register their own Telegram bot as an operator (with approval). */
  OPERATORS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** AES-256-GCM key (32 bytes, base64) for operators' bot tokens at rest. */
  OPERATOR_SECRET_KEY_B64: optionalEnv(
    z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'must be 32 random bytes, base64 (run scripts/init-env.sh)',
      ),
  ),
  /** Public URL of this API; operators' bots send their updates here. */
  TELEGRAM_WEBHOOK_BASE_URL: optionalEnv(z.string().url()),
  MAX_OPERATORS_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
  /** Plan limits, enforced only while the store is on. */
  CLUB_FREE_MAX_OPEN_TABLES: z.coerce.number().int().min(1).max(1000).default(3),
  CLUB_FREE_MAX_MEMBERS: z.coerce.number().int().min(2).max(100000).default(50),
  CLUB_PRO_MAX_OPEN_TABLES: z.coerce.number().int().min(1).max(1000).default(30),
  CLUB_PRO_MAX_MEMBERS: z.coerce.number().int().min(2).max(100000).default(1000),
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
      if (cfg.TELEGRAM_BOT_TOKEN) {
        for (const key of [
          'TELEGRAM_BOT_USERNAME',
          'TELEGRAM_WEBHOOK_SECRET',
          'TELEGRAM_MINI_APP_URL',
        ] as const) {
          if (!cfg[key]) {
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'required with TELEGRAM_BOT_TOKEN',
            });
          }
        }
        if (
          cfg.APP_ENV === 'production' &&
          cfg.TELEGRAM_MINI_APP_URL &&
          !cfg.TELEGRAM_MINI_APP_URL.startsWith('https://')
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['TELEGRAM_MINI_APP_URL'],
            message: 'must be https in production (Telegram opens only https Mini Apps)',
          });
        }
      }
      if (cfg.OPERATORS_ENABLED) {
        for (const key of [
          'OPERATOR_SECRET_KEY_B64',
          'TELEGRAM_WEBHOOK_BASE_URL',
          'TELEGRAM_MINI_APP_URL',
        ] as const) {
          if (!cfg[key]) {
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'required with OPERATORS_ENABLED',
            });
          }
        }
        if (
          cfg.APP_ENV === 'production' &&
          cfg.TELEGRAM_WEBHOOK_BASE_URL &&
          !cfg.TELEGRAM_WEBHOOK_BASE_URL.startsWith('https://')
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['TELEGRAM_WEBHOOK_BASE_URL'],
            message: 'must be https in production (Telegram delivers webhooks over https only)',
          });
        }
      }
      if (cfg.TELEGRAM_STARS_ENABLED) {
        for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_SUPPORT_CONTACT'] as const) {
          if (!cfg[key]) {
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'required with TELEGRAM_STARS_ENABLED (Telegram requires payment support)',
            });
          }
        }
      }
      if (
        cfg.CLUB_PRO_MAX_OPEN_TABLES < cfg.CLUB_FREE_MAX_OPEN_TABLES ||
        cfg.CLUB_PRO_MAX_MEMBERS < cfg.CLUB_FREE_MAX_MEMBERS
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLUB_PRO_MAX_OPEN_TABLES'],
          message: 'Club Pro limits must be at least the free limits',
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
