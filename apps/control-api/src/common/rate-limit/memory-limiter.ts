import type { RateLimitResult } from './rate-limit.service';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters in process memory: the fallback for rules that must
 * not fail open while Redis is unavailable (login and other credential
 * endpoints). Limits apply per process, so with N replicas an attacker gets
 * at most N times the budget. The key count is bounded: expired windows are
 * swept when the map is full, then the oldest entries are dropped.
 */
export class MemoryRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maxKeys = 100_000,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  hit(key: string, limit: number, windowSec: number): RateLimitResult {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.delete(key);
      if (this.windows.size >= this.maxKeys) this.evict(now);
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= limit,
      remaining: Math.max(0, limit - w.count),
      retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
    };
  }

  private evict(now: number): void {
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
    // Still full: drop the oldest tenth (Map iterates in insertion order).
    if (this.windows.size >= this.maxKeys) {
      let drop = Math.max(1, Math.floor(this.maxKeys / 10));
      for (const key of this.windows.keys()) {
        if (drop-- <= 0) break;
        this.windows.delete(key);
      }
    }
  }
}
