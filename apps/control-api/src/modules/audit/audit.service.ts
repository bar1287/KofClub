import { Injectable } from '@nestjs/common';
import { uuidv7 } from '../../common/ids';
import type { RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { Database, Queryable } from '../../infra/database/database';

export interface AuditEntry {
  action: string;
  objectType: string;
  objectId?: string | null;
  clubId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditRecordDto {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  clubId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}

/**
 * Append-only audit trail for privileged actions. Callers pass their
 * transaction client so the audit record commits atomically with the change.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: Database) {}

  async record(q: Queryable, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    await q.query(
      `INSERT INTO audit_log (id, actor_user_id, club_id, action, object_type, object_id,
                              before_json, after_json, request_id, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv7(),
        ctx.auth?.userId ?? null,
        entry.clubId ?? null,
        entry.action,
        entry.objectType,
        entry.objectId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        ctx.requestId || null,
        ctx.ipHash,
      ],
    );
  }

  async list(
    filter: { clubId?: string; actorUserId?: string; action?: string },
    limit: number,
    cursor?: string,
  ): Promise<Page<AuditRecordDto>> {
    const after = decodeCursor(cursor, ['createdAt', 'id'] as const);
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.clubId) {
      params.push(filter.clubId);
      where.push(`a.club_id = $${params.length}`);
    }
    if (filter.actorUserId) {
      params.push(filter.actorUserId);
      where.push(`a.actor_user_id = $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      where.push(`a.action = $${params.length}`);
    }
    if (after) {
      params.push(after.createdAt, after.id);
      where.push(
        `(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const res = await this.db.query<{
      id: string;
      actor_user_id: string | null;
      actor_username: string | null;
      club_id: string | null;
      action: string;
      object_type: string;
      object_id: string | null;
      before_json: unknown;
      after_json: unknown;
      request_id: string | null;
      created_at: Date;
      created_at_key: string;
    }>(
      `SELECT a.created_at::text AS created_at_key, a.id, a.actor_user_id, u.username AS actor_username, a.club_id, a.action,
              a.object_type, a.object_id, a.before_json, a.after_json, a.request_id, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorUsername: r.actor_username,
        clubId: r.club_id,
        action: r.action,
        objectType: r.object_type,
        objectId: r.object_id,
        before: r.before_json,
        after: r.after_json,
        requestId: r.request_id,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor:
        res.rows.length > limit && last
          ? encodeCursor({ createdAt: last.created_at_key, id: last.id })
          : null,
    };
  }
}
