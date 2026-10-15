import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export interface ClubSubscriptionRow {
  clubId: string;
  orderId: string;
  subscriberUserId: string;
  subscriberTelegramId: number;
  subscriptionChargeId: string;
  activeUntil: Date;
  renewing: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const map = (r: any): ClubSubscriptionRow => ({
  clubId: r.club_id,
  orderId: r.order_id,
  subscriberUserId: r.subscriber_user_id,
  subscriberTelegramId: Number(r.subscriber_telegram_id),
  subscriptionChargeId: r.subscription_charge_id,
  activeUntil: r.active_until,
  renewing: r.renewing,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const COLS =
  'club_id, order_id, subscriber_user_id, subscriber_telegram_id, subscription_charge_id, active_until, renewing';

/** Club Pro subscriptions (owned by the plans module). */
@Injectable()
export class ClubSubscriptionsRepository {
  constructor(private readonly db: Database) {}

  async find(clubId: string, q: Queryable = this.db): Promise<ClubSubscriptionRow | null> {
    const res = await q.query(`SELECT ${COLS} FROM club_subscriptions WHERE club_id = $1`, [
      clubId,
    ]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /**
   * Starts or extends Club Pro. A paid period never shrinks: the later of
   * the current end and the new one wins. A new subscription (another
   * order) takes over the renewal.
   */
  async upsert(
    q: Queryable,
    s: Omit<ClubSubscriptionRow, 'renewing'>,
  ): Promise<ClubSubscriptionRow> {
    const res = await q.query(
      `INSERT INTO club_subscriptions AS c
         (club_id, order_id, subscriber_user_id, subscriber_telegram_id, subscription_charge_id, active_until)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (club_id) DO UPDATE SET
         order_id = EXCLUDED.order_id,
         subscriber_user_id = EXCLUDED.subscriber_user_id,
         subscriber_telegram_id = EXCLUDED.subscriber_telegram_id,
         subscription_charge_id = CASE WHEN c.order_id = EXCLUDED.order_id
                                       THEN c.subscription_charge_id
                                       ELSE EXCLUDED.subscription_charge_id END,
         active_until = GREATEST(c.active_until, EXCLUDED.active_until),
         renewing = CASE WHEN c.order_id = EXCLUDED.order_id THEN c.renewing ELSE true END,
         updated_at = now()
       RETURNING ${COLS}`,
      [
        s.clubId,
        s.orderId,
        s.subscriberUserId,
        s.subscriberTelegramId,
        s.subscriptionChargeId,
        s.activeUntil,
      ],
    );
    return map(res.rows[0]);
  }

  /** Ends the paid period now and stops renewal (a refunded charge). */
  async endForOrder(q: Queryable, orderId: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE club_subscriptions
          SET active_until = LEAST(active_until, now()), renewing = false, updated_at = now()
        WHERE order_id = $1`,
      [orderId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async setRenewing(q: Queryable, clubId: string, renewing: boolean): Promise<void> {
    await q.query(
      `UPDATE club_subscriptions SET renewing = $2, updated_at = now() WHERE club_id = $1`,
      [clubId, renewing],
    );
  }

  /**
   * Serializes plan-limit checks for one club within a transaction, so two
   * concurrent joins cannot both take the last free place.
   */
  async lockClub(q: Queryable, clubId: string): Promise<void> {
    await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('club-plan:' || $1, 0))`, [
      clubId,
    ]);
  }
}
