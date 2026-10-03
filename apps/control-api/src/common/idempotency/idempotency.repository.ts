import { Injectable } from '@nestjs/common';
import { Database } from '../../infra/database/database';

export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number | null;
  responseBody: unknown;
  createdAt: Date;
}

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly db: Database) {}

  /** Inserts an in-progress record; returns false when the key already exists. */
  async begin(
    userId: string,
    key: string,
    method: string,
    path: string,
    requestHash: string,
  ): Promise<boolean> {
    const res = await this.db.query(
      `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, key, method, path, requestHash],
    );
    return res.rowCount === 1;
  }

  async find(userId: string, key: string): Promise<IdempotencyRecord | null> {
    const res = await this.db.query<{
      request_hash: string;
      status_code: number | null;
      response_body: unknown;
      created_at: Date;
    }>(
      `SELECT request_hash, status_code, response_body, created_at
         FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = res.rows[0];
    return row
      ? {
          requestHash: row.request_hash,
          statusCode: row.status_code,
          responseBody: row.response_body,
          createdAt: row.created_at,
        }
      : null;
  }

  async complete(userId: string, key: string, statusCode: number, body: unknown): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys SET status_code = $3, response_body = $4, completed_at = now()
        WHERE user_id = $1 AND key = $2`,
      [userId, key, statusCode, JSON.stringify(body ?? null)],
    );
  }

  /** Releases a key whose request failed so the client can retry. */
  async release(userId: string, key: string): Promise<void> {
    await this.db.query(
      `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND completed_at IS NULL`,
      [userId, key],
    );
  }

  /** Reclaims an abandoned in-progress record (process crashed mid-request). */
  async reclaimStale(userId: string, key: string, olderThanSec: number): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM idempotency_keys
        WHERE user_id = $1 AND key = $2 AND completed_at IS NULL
          AND created_at < now() - make_interval(secs => $3)`,
      [userId, key, olderThanSec],
    );
    return res.rowCount === 1;
  }
}
