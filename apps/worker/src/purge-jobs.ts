import type { Pool } from 'pg';
import type { Job } from './jobs';

/** Idempotency records only need to outlive client retry windows. */
export function purgeIdempotencyKeys(pool: Pool, retentionHours = 24): Job {
  return {
    name: 'purge-idempotency-keys',
    async run() {
      const res = await pool.query(
        `DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => $1)`,
        [retentionHours],
      );
      return { affected: res.rowCount ?? 0 };
    },
  };
}
