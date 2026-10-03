import { SetMetadata } from '@nestjs/common';

export interface RateLimitRule {
  /** Logical bucket name, e.g. "auth:login:ip". */
  name: string;
  /** Dimension used for the counter key. */
  by: 'ip' | 'user' | { body: string };
  limit: number;
  windowSec: number;
}

export const RATE_LIMIT_RULES = 'kofclub:rateLimitRules';

/** Applies additional rate-limit rules to a route (on top of the default). */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_RULES, rules);

/** Default per-route budget applied to every request (per user, else per IP). */
export const DEFAULT_RULE: Omit<RateLimitRule, 'by'> = {
  name: 'default',
  limit: 300,
  windowSec: 60,
};
