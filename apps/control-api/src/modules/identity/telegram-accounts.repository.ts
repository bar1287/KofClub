import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export interface TelegramAccountRow {
  userId: string;
  telegramUserId: number;
  telegramUsername: string | null;
  firstName: string | null;
  linkedAt: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const map = (r: any): TelegramAccountRow => ({
  userId: r.user_id,
  telegramUserId: Number(r.telegram_user_id),
  telegramUsername: r.telegram_username,
  firstName: r.first_name,
  linkedAt: r.linked_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLS = 'user_id, telegram_user_id, telegram_username, first_name, linked_at';

/** Links between users and Telegram accounts (owned by the identity module). */
@Injectable()
export class TelegramAccountsRepository {
  constructor(private readonly db: Database) {}

  async findByTelegramId(telegramUserId: number, q: Queryable = this.db) {
    const res = await q.query(`SELECT ${COLS} FROM telegram_accounts WHERE telegram_user_id = $1`, [
      telegramUserId,
    ]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async findByUser(userId: string, q: Queryable = this.db): Promise<TelegramAccountRow | null> {
    const res = await q.query(`SELECT ${COLS} FROM telegram_accounts WHERE user_id = $1`, [userId]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async insert(
    q: Queryable,
    a: {
      userId: string;
      telegramUserId: number;
      username: string | null;
      firstName: string | null;
    },
  ): Promise<TelegramAccountRow> {
    const res = await q.query(
      `INSERT INTO telegram_accounts (user_id, telegram_user_id, telegram_username, first_name)
       VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [a.userId, a.telegramUserId, a.username, a.firstName],
    );
    return map(res.rows[0]);
  }

  /** Keeps the Telegram name current and records the visit. */
  async touch(telegramUserId: number, username: string | null, firstName: string | null) {
    await this.db.query(
      `UPDATE telegram_accounts
          SET telegram_username = $2, first_name = $3, last_seen_at = now()
        WHERE telegram_user_id = $1`,
      [telegramUserId, username, firstName],
    );
  }

  async delete(q: Queryable, userId: string): Promise<boolean> {
    const res = await q.query(`DELETE FROM telegram_accounts WHERE user_id = $1`, [userId]);
    return (res.rowCount ?? 0) > 0;
  }
}
