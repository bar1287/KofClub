import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import type { Entitlement, ProductId } from './store.catalog';

export interface StarOrderRow {
  id: string;
  userId: string;
  telegramUserId: number;
  product: ProductId;
  clubId: string | null;
  stars: number;
  status: 'PENDING' | 'PAID';
  createdAt: Date;
}

export interface StarPaymentRow {
  id: string;
  orderId: string | null;
  product: ProductId | null;
  clubId: string | null;
  userId: string | null;
  username: string | null;
  telegramUserId: number;
  telegramChargeId: string;
  stars: number;
  recurring: boolean;
  subscriptionExpiresAt: Date | null;
  paidAt: Date;
  refundedAt: Date | null;
  refundReason: string | null;
  /** paid_at at full precision, for keyset pagination. */
  cursorKey: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapOrder = (r: any): StarOrderRow => ({
  id: r.id,
  userId: r.user_id,
  telegramUserId: Number(r.telegram_user_id),
  product: r.product,
  clubId: r.club_id,
  stars: Number(r.stars),
  status: r.status,
  createdAt: r.created_at,
});

const mapPayment = (r: any): StarPaymentRow => ({
  id: r.id,
  orderId: r.order_id,
  product: r.product ?? null,
  clubId: r.club_id ?? null,
  userId: r.user_id,
  username: r.username ?? null,
  telegramUserId: Number(r.telegram_user_id),
  telegramChargeId: r.telegram_charge_id,
  stars: Number(r.stars),
  recurring: r.recurring,
  subscriptionExpiresAt: r.subscription_expires_at,
  paidAt: r.paid_at,
  refundedAt: r.refunded_at,
  refundReason: r.refund_reason,
  cursorKey: r.cursor_key,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const ORDER_COLS = 'id, user_id, telegram_user_id, product, club_id, stars, status, created_at';
const PAYMENT_SELECT = `
  SELECT p.id, p.order_id, o.product, o.club_id, p.user_id, u.username, p.telegram_user_id,
         p.telegram_charge_id, p.stars, p.recurring, p.subscription_expires_at, p.paid_at,
         p.refunded_at, p.refund_reason, p.paid_at::text AS cursor_key
    FROM star_payments p
    LEFT JOIN star_orders o ON o.id = p.order_id
    LEFT JOIN users u ON u.id = p.user_id`;

/** Stars orders, payments and entitlements (owned by the store module). */
@Injectable()
export class StoreRepository {
  constructor(private readonly db: Database) {}

  async insertOrder(
    q: Queryable,
    o: Omit<StarOrderRow, 'status' | 'createdAt'>,
  ): Promise<StarOrderRow> {
    const res = await q.query(
      `INSERT INTO star_orders (id, user_id, telegram_user_id, product, club_id, stars)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ORDER_COLS}`,
      [o.id, o.userId, o.telegramUserId, o.product, o.clubId, o.stars],
    );
    return mapOrder(res.rows[0]);
  }

  async findOrder(id: string, q: Queryable = this.db): Promise<StarOrderRow | null> {
    const res = await q.query(`SELECT ${ORDER_COLS} FROM star_orders WHERE id = $1`, [id]);
    return res.rows[0] ? mapOrder(res.rows[0]) : null;
  }

  async markOrderPaid(q: Queryable, id: string): Promise<void> {
    await q.query(`UPDATE star_orders SET status = 'PAID' WHERE id = $1`, [id]);
  }

  /** Records a charge once; null when this charge id was seen before. */
  async insertPayment(
    q: Queryable,
    p: {
      id: string;
      orderId: string | null;
      userId: string | null;
      telegramUserId: number;
      telegramChargeId: string;
      stars: number;
      recurring: boolean;
      subscriptionExpiresAt: Date | null;
    },
  ): Promise<string | null> {
    const res = await q.query<{ id: string }>(
      `INSERT INTO star_payments (id, order_id, user_id, telegram_user_id, telegram_charge_id,
                                  stars, recurring, subscription_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (telegram_charge_id) DO NOTHING
       RETURNING id`,
      [
        p.id,
        p.orderId,
        p.userId,
        p.telegramUserId,
        p.telegramChargeId,
        p.stars,
        p.recurring,
        p.subscriptionExpiresAt,
      ],
    );
    return res.rows[0]?.id ?? null;
  }

  async findPayment(id: string, q: Queryable = this.db): Promise<StarPaymentRow | null> {
    const res = await q.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
    return res.rows[0] ? mapPayment(res.rows[0]) : null;
  }

  async findPaymentByCharge(
    chargeId: string,
    q: Queryable = this.db,
  ): Promise<StarPaymentRow | null> {
    const res = await q.query(`${PAYMENT_SELECT} WHERE p.telegram_charge_id = $1`, [chargeId]);
    return res.rows[0] ? mapPayment(res.rows[0]) : null;
  }

  /** Locks the payment row; true when it was not refunded before. */
  async markRefunded(q: Queryable, id: string, reason: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE star_payments SET refunded_at = now(), refund_reason = $2
        WHERE id = $1 AND refunded_at IS NULL`,
      [id, reason],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listForUser(userId: string, limit = 50): Promise<StarPaymentRow[]> {
    const res = await this.db.query(
      `${PAYMENT_SELECT} WHERE p.user_id = $1 ORDER BY p.paid_at DESC, p.id DESC LIMIT $2`,
      [userId, limit],
    );
    return res.rows.map(mapPayment);
  }

  /** Newest first; `after` is the (paidAt, id) of the previous page's last row. */
  async listAll(
    limit: number,
    after: { paidAt: string; id: string } | null,
  ): Promise<StarPaymentRow[]> {
    const res = after
      ? await this.db.query(
          `${PAYMENT_SELECT} WHERE (p.paid_at, p.id) < ($1::timestamptz, $2::uuid)
            ORDER BY p.paid_at DESC, p.id DESC LIMIT $3`,
          [after.paidAt, after.id, limit],
        )
      : await this.db.query(`${PAYMENT_SELECT} ORDER BY p.paid_at DESC, p.id DESC LIMIT $1`, [
          limit,
        ]);
    return res.rows.map(mapPayment);
  }

  // --- entitlements --------------------------------------------------------

  async entitlements(userId: string, q: Queryable = this.db): Promise<Entitlement[]> {
    const res = await q.query<{ entitlement: Entitlement }>(
      `SELECT entitlement FROM user_entitlements WHERE user_id = $1 ORDER BY entitlement`,
      [userId],
    );
    return res.rows.map((r) => r.entitlement);
  }

  async grant(
    q: Queryable,
    userId: string,
    entitlement: Entitlement,
    paymentId: string,
  ): Promise<void> {
    await q.query(
      `INSERT INTO user_entitlements (user_id, entitlement, payment_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, entitlement) DO NOTHING`,
      [userId, entitlement, paymentId],
    );
  }

  /** Takes back what a refunded payment granted. */
  async revokeForPayment(q: Queryable, paymentId: string): Promise<void> {
    await q.query(`DELETE FROM user_entitlements WHERE payment_id = $1`, [paymentId]);
  }
}
