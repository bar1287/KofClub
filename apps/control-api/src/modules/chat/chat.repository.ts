import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import type { ChatReportStatus } from './chat.schemas';

export interface ChatMessageRow {
  id: string;
  clubId: string;
  tableId: string;
  userId: string;
  username: string;
  body: string;
  hidden: boolean;
  createdAt: Date;
}

export interface ChatReportRow {
  id: string;
  clubId: string;
  tableId: string;
  messageId: string;
  reportedUserId: string;
  reportedUsername: string;
  reporterUserId: string;
  reporterUsername: string;
  body: string;
  reason: string | null;
  status: ChatReportStatus;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Messages are shown and kept for this long (the worker purges older ones). */
export const CHAT_RETENTION_DAYS = 7;

const MESSAGE_COLS = `m.id, m.club_id, m.table_id, m.user_id, u.username, m.body,
                      m.hidden_at IS NOT NULL AS hidden, m.created_at`;
const REPORT_SELECT = `
  SELECT r.id, r.club_id, r.table_id, r.message_id, r.reported_user_id, reported.username AS reported_username,
         r.reporter_user_id, reporter.username AS reporter_username, r.body, r.reason, r.status,
         r.resolved_at, r.created_at
    FROM chat_reports r
    JOIN users reported ON reported.id = r.reported_user_id
    JOIN users reporter ON reporter.id = r.reporter_user_id`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapMessage = (r: any): ChatMessageRow => ({
  id: r.id,
  clubId: r.club_id,
  tableId: r.table_id,
  userId: r.user_id,
  username: r.username,
  body: r.body,
  hidden: r.hidden,
  createdAt: r.created_at,
});
const mapReport = (r: any): ChatReportRow => ({
  id: r.id,
  clubId: r.club_id,
  tableId: r.table_id,
  messageId: r.message_id,
  reportedUserId: r.reported_user_id,
  reportedUsername: r.reported_username,
  reporterUserId: r.reporter_user_id,
  reporterUsername: r.reporter_username,
  body: r.body,
  reason: r.reason,
  status: r.status,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Data access for table chat messages and reports (owned by the chat module). */
@Injectable()
export class ChatRepository {
  constructor(private readonly db: Database) {}

  /**
   * Stores a message once per (sender, requestId); a retried send returns
   * the stored message with created=false.
   */
  async insertMessage(m: {
    id: string;
    clubId: string;
    tableId: string;
    userId: string;
    requestId: string;
    body: string;
  }): Promise<{ message: ChatMessageRow; created: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO chat_messages (id, club_id, table_id, user_id, request_id, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, request_id) DO NOTHING
       RETURNING id`,
      [m.id, m.clubId, m.tableId, m.userId, m.requestId, m.body],
    );
    const res = await this.db.query(
      `SELECT ${MESSAGE_COLS} FROM chat_messages m JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1 AND m.request_id = $2`,
      [m.userId, m.requestId],
    );
    return { message: mapMessage(res.rows[0]), created: inserted.rowCount === 1 };
  }

  /** The latest visible messages at a table, oldest first. */
  async recent(tableId: string, limit: number): Promise<ChatMessageRow[]> {
    const res = await this.db.query(
      `SELECT ${MESSAGE_COLS} FROM chat_messages m JOIN users u ON u.id = m.user_id
        WHERE m.table_id = $1 AND m.hidden_at IS NULL
          AND m.created_at > now() - make_interval(days => $2)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3`,
      [tableId, CHAT_RETENTION_DAYS, limit],
    );
    return res.rows.map(mapMessage).reverse();
  }

  async findMessage(id: string): Promise<ChatMessageRow | null> {
    const res = await this.db.query(
      `SELECT ${MESSAGE_COLS} FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
      [id],
    );
    return res.rows[0] ? mapMessage(res.rows[0]) : null;
  }

  /** Files a report once per (message, reporter); a repeat returns the first. */
  async insertReport(r: {
    id: string;
    message: ChatMessageRow;
    reporterUserId: string;
    reason: string | null;
  }): Promise<{ report: ChatReportRow; created: boolean }> {
    const inserted = await this.db.query(
      `INSERT INTO chat_reports (id, club_id, table_id, message_id, reported_user_id, reporter_user_id, body, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (message_id, reporter_user_id) DO NOTHING
       RETURNING id`,
      [
        r.id,
        r.message.clubId,
        r.message.tableId,
        r.message.id,
        r.message.userId,
        r.reporterUserId,
        r.message.body,
        r.reason,
      ],
    );
    const res = await this.db.query(
      `${REPORT_SELECT} WHERE r.message_id = $1 AND r.reporter_user_id = $2`,
      [r.message.id, r.reporterUserId],
    );
    return { report: mapReport(res.rows[0]), created: inserted.rowCount === 1 };
  }

  /** Reports in a club, newest first (ids are time-ordered UUIDv7). */
  async listReports(
    clubId: string,
    status: ChatReportStatus | undefined,
    limit: number,
    beforeId?: string,
  ): Promise<ChatReportRow[]> {
    const res = await this.db.query(
      `${REPORT_SELECT}
        WHERE r.club_id = $1
          AND ($2::text IS NULL OR r.status = $2)
          AND ($3::uuid IS NULL OR r.id < $3)
        ORDER BY r.id DESC
        LIMIT $4`,
      [clubId, status ?? null, beforeId ?? null, limit],
    );
    return res.rows.map(mapReport);
  }

  async findReport(
    q: Queryable,
    clubId: string,
    reportId: string,
    forUpdate = false,
  ): Promise<ChatReportRow | null> {
    const res = await q.query(
      `${REPORT_SELECT} WHERE r.club_id = $1 AND r.id = $2 ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
      [clubId, reportId],
    );
    return res.rows[0] ? mapReport(res.rows[0]) : null;
  }

  async dismissReport(q: Queryable, reportId: string, resolvedBy: string): Promise<void> {
    await q.query(
      `UPDATE chat_reports SET status = 'DISMISSED', resolved_by = $2, resolved_at = now()
        WHERE id = $1`,
      [reportId, resolvedBy],
    );
  }

  /** Hides a message and resolves every open report of it as HIDDEN. */
  async hideMessage(q: Queryable, messageId: string, resolvedBy: string): Promise<void> {
    await q.query(
      `UPDATE chat_messages SET hidden_at = now() WHERE id = $1 AND hidden_at IS NULL`,
      [messageId],
    );
    await q.query(
      `UPDATE chat_reports SET status = 'HIDDEN', resolved_by = $2, resolved_at = now()
        WHERE message_id = $1 AND status = 'OPEN'`,
      [messageId, resolvedBy],
    );
  }
}
