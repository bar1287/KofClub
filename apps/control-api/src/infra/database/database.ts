import { Pool, PoolClient, QueryResultRow } from 'pg';

/** Minimal query interface satisfied by both Pool and PoolClient. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

/**
 * Thin wrapper around a pg Pool. Repositories receive a Queryable so the
 * same code runs inside or outside an explicit transaction.
 */
export class Database {
  constructor(readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    return this.pool.query<R>(text, values);
  }

  /**
   * Runs fn inside a transaction. Serialization failures and deadlocks are
   * retried (bounded) because they are expected under concurrency.
   */
  async tx<T>(
    fn: (client: PoolClient) => Promise<T>,
    opts: {
      isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
      retries?: number;
    } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? 'READ COMMITTED'}`);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = (err as { code?: string }).code;
        if (attempt < retries && (code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED)) {
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

/** Postgres unique_violation error code. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === UNIQUE_VIOLATION && (constraint === undefined || e.constraint === constraint);
}
