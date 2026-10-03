import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Database } from '../infra/database/database';
import { REDIS } from '../infra/redis/redis.module';

export interface HealthReport {
  status: 'ok' | 'unavailable' | 'draining';
  service: string;
  checks?: Record<string, string>;
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}

@Injectable()
export class HealthService {
  private draining = false;

  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  setDraining(value: boolean): void {
    this.draining = value;
  }

  live(): HealthReport {
    return { status: 'ok', service: 'control-api' };
  }

  async ready(): Promise<HealthReport> {
    const checks: Record<string, string> = {};
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await withTimeout(fn(), CHECK_TIMEOUT_MS);
        checks[name] = 'ok';
      } catch (err) {
        checks[name] = `fail: ${(err as Error).message}`;
      }
    };
    await Promise.all([
      run('postgres', () => this.db.ping()),
      run('redis', () => this.redis.ping()),
    ]);
    const healthy = Object.values(checks).every((c) => c === 'ok');
    const status = this.draining ? 'draining' : healthy ? 'ok' : 'unavailable';
    return { status, service: 'control-api', checks };
  }
}
