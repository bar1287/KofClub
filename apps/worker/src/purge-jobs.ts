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

/**
 * Table chat is kept for a week (roadmap W1.4). Reports keep their own copy
 * of a reported message, so purging never loses moderation evidence.
 */
export function purgeChatMessages(pool: Pool, retentionDays = 7): Job {
  return {
    name: 'purge-chat-messages',
    async run() {
      const res = await pool.query(
        `DELETE FROM chat_messages WHERE created_at < now() - make_interval(days => $1)`,
        [retentionDays],
      );
      return { affected: res.rowCount ?? 0 };
    },
  };
}
