import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export type OperatorStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface OperatorRow {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  status: OperatorStatus;
  statusReason: string | null;
  botId: number;
  botUsername: string;
  botTokenSealed: Buffer;
  webhookSecretHash: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  /** created_at at full precision, for keyset pagination. */
  cursorKey: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const map = (r: any): OperatorRow => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  ownerUserId: r.owner_user_id,
  ownerUsername: r.owner_username,
  status: r.status,
  statusReason: r.status_reason,
  botId: Number(r.bot_id),
  botUsername: r.bot_username,
  botTokenSealed: r.bot_token_sealed,
  webhookSecretHash: r.webhook_secret_hash,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  cursorKey: r.cursor_key,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT = `
  SELECT o.id, o.slug, o.name, o.owner_user_id, u.username AS owner_username, o.status,
         o.status_reason, o.bot_id, o.bot_username, o.bot_token_sealed, o.webhook_secret_hash,
         o.created_at, o.reviewed_at, o.created_at::text AS cursor_key
    FROM operators o JOIN users u ON u.id = o.owner_user_id`;

/** Operators (owned by the operators module, ADR-019). */
@Injectable()
export class OperatorsRepository {
  constructor(private readonly db: Database) {}

  async insert(
    q: Queryable,
    o: {
      id: string;
      slug: string;
      name: string;
      ownerUserId: string;
      botId: number;
      botUsername: string;
      botTokenSealed: Buffer;
    },
  ): Promise<void> {
    await q.query(
      `INSERT INTO operators (id, slug, name, owner_user_id, bot_id, bot_username, bot_token_sealed,
                              terms_accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [o.id, o.slug, o.name, o.ownerUserId, o.botId, o.botUsername, o.botTokenSealed],
    );
  }

  async find(id: string, q: Queryable = this.db): Promise<OperatorRow | null> {
    const res = await q.query(`${SELECT} WHERE o.id = $1`, [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<OperatorRow | null> {
    const res = await this.db.query(`${SELECT} WHERE o.slug = $1`, [slug]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async listByOwner(userId: string): Promise<OperatorRow[]> {
    const res = await this.db.query(`${SELECT} WHERE o.owner_user_id = $1 ORDER BY o.created_at`, [
      userId,
    ]);
    return res.rows.map(map);
  }

  async countByOwner(q: Queryable, userId: string): Promise<number> {
    const res = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM operators WHERE owner_user_id = $1 AND status <> 'REJECTED'`,
      [userId],
    );
    return res.rows[0]!.n;
  }

  async list(
    status: OperatorStatus | undefined,
    limit: number,
    after: { createdAt: string; id: string } | null,
  ): Promise<OperatorRow[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (status) {
      args.push(status);
      where.push(`o.status = $${args.length}`);
    }
    if (after) {
      args.push(after.createdAt, after.id);
      where.push(
        `(o.created_at, o.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`,
      );
    }
    args.push(limit);
    const res = await this.db.query(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.created_at DESC, o.id DESC LIMIT $${args.length}`,
      args,
    );
    return res.rows.map(map);
  }

  async setStatus(
    q: Queryable,
    id: string,
    s: { status: OperatorStatus; reason: string; reviewedBy: string },
  ): Promise<void> {
    await q.query(
      `UPDATE operators SET status = $2, status_reason = $3, reviewed_by = $4, reviewed_at = now()
        WHERE id = $1`,
      [id, s.status, s.reason, s.reviewedBy],
    );
  }

  async setWebhookSecretHash(id: string, hash: string | null): Promise<void> {
    await this.db.query(`UPDATE operators SET webhook_secret_hash = $2 WHERE id = $1`, [id, hash]);
  }

  async setBotToken(id: string, sealed: Buffer): Promise<void> {
    await this.db.query(`UPDATE operators SET bot_token_sealed = $2 WHERE id = $1`, [id, sealed]);
  }
}
