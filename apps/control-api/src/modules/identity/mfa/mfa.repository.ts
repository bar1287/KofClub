import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../../infra/database/database';

export interface MfaRow {
  userId: string;
  secretEnc: Buffer;
  enabledAt: Date | null;
  lastUsedStep: number;
}

interface DbMfa {
  user_id: string;
  totp_secret_enc: Buffer;
  enabled_at: Date | null;
  last_used_step: string;
}

const map = (r: DbMfa): MfaRow => ({
  userId: r.user_id,
  secretEnc: r.totp_secret_enc,
  enabledAt: r.enabled_at,
  lastUsedStep: Number(r.last_used_step),
});

/** `user_mfa` and `user_mfa_recovery_codes` (identity-owned tables). */
@Injectable()
export class MfaRepository {
  constructor(private readonly db: Database) {}

  async find(userId: string, q: Queryable = this.db, lock = false): Promise<MfaRow | null> {
    const res = await q.query<DbMfa>(
      `SELECT user_id, totp_secret_enc, enabled_at, last_used_step FROM user_mfa WHERE user_id = $1
       ${lock ? 'FOR UPDATE' : ''}`,
      [userId],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** Stores a pending secret, replacing a pending (never an enabled) one. */
  async savePending(userId: string, secretEnc: Buffer): Promise<boolean> {
    const res = await this.db.query(
      `INSERT INTO user_mfa (user_id, totp_secret_enc) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET totp_secret_enc = EXCLUDED.totp_secret_enc, last_used_step = 0
        WHERE user_mfa.enabled_at IS NULL`,
      [userId, secretEnc],
    );
    return res.rowCount === 1;
  }

  async enable(q: Queryable, userId: string, step: number): Promise<void> {
    await q.query(
      `UPDATE user_mfa SET enabled_at = now(), last_used_step = $2 WHERE user_id = $1`,
      [userId, step],
    );
  }

  /** Records a used TOTP step; false when that step (or a later one) was used already. */
  async useStep(q: Queryable, userId: string, step: number): Promise<boolean> {
    const res = await q.query(
      `UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1 AND last_used_step < $2`,
      [userId, step],
    );
    return res.rowCount === 1;
  }

  async replaceRecoveryCodes(q: Queryable, userId: string, hashes: Buffer[]): Promise<void> {
    await q.query(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId]);
    await q.query(
      `INSERT INTO user_mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::bytea[])`,
      [userId, hashes],
    );
  }

  /** Consumes an unused recovery code; false when unknown or already used. */
  async useRecoveryCode(q: Queryable, userId: string, hash: Buffer): Promise<boolean> {
    const res = await q.query(
      `UPDATE user_mfa_recovery_codes SET used_at = now()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
      [userId, hash],
    );
    return res.rowCount === 1;
  }

  async recoveryCodesLeft(userId: string): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** Removes the user's second factor and un-verifies their sessions. */
  async remove(q: Queryable, userId: string): Promise<void> {
    await q.query(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId]);
    await q.query(`DELETE FROM user_mfa WHERE user_id = $1`, [userId]);
    await q.query(`UPDATE sessions SET mfa_at = NULL WHERE user_id = $1 AND mfa_at IS NOT NULL`, [
      userId,
    ]);
  }
}
