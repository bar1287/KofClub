import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import type { PlatformRole, UserStatus } from './users.repository';

export type RevokeReason =
  'LOGOUT' | 'USER_REVOKED' | 'REFRESH_REUSE' | 'ADMIN' | 'ACCOUNT_SUSPENDED';

export interface SessionRow {
  id: string;
  userId: string;
  deviceId: string | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** When the session was verified with a second factor (ADR-017). */
  mfaAt: Date | null;
}

interface DbSession {
  id: string;
  user_id: string;
  device_id: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  mfa_at: Date | null;
}

const COLUMNS =
  'id, user_id, device_id, user_agent, ip_hash, created_at, last_used_at, expires_at, revoked_at, mfa_at';

function map(r: DbSession): SessionRow {
  return {
    id: r.id,
    userId: r.user_id,
    deviceId: r.device_id,
    userAgent: r.user_agent,
    ipHash: r.ip_hash,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    mfaAt: r.mfa_at,
  };
}

export interface SessionAuthState {
  sessionRevoked: boolean;
  sessionExpired: boolean;
  userStatus: UserStatus;
  platformRole: PlatformRole;
  mfa: boolean;
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly db: Database) {}

  async insert(
    q: Queryable,
    s: {
      id: string;
      userId: string;
      refreshHash: Buffer;
      deviceId: string | null;
      userAgent: string | null;
      ipHash: string | null;
      expiresAt: Date;
      mfa?: boolean;
    },
  ): Promise<SessionRow> {
    const res = await q.query<DbSession>(
      `INSERT INTO sessions (id, user_id, refresh_hash, device_id, user_agent, ip_hash, expires_at, mfa_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN now() END) RETURNING ${COLUMNS}`,
      [
        s.id,
        s.userId,
        s.refreshHash,
        s.deviceId,
        s.userAgent,
        s.ipHash,
        s.expiresAt,
        s.mfa ?? false,
      ],
    );
    return map(res.rows[0]!);
  }

  async findByRefreshHash(q: Queryable, hash: Buffer): Promise<SessionRow | null> {
    const res = await q.query<DbSession>(
      `SELECT ${COLUMNS} FROM sessions WHERE refresh_hash = $1 FOR UPDATE`,
      [hash],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** Returns the session that previously owned a rotated refresh token. */
  async findSessionIdByRetiredToken(q: Queryable, hash: Buffer): Promise<string | null> {
    const res = await q.query<{ session_id: string }>(
      `SELECT session_id FROM session_refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    return res.rows[0]?.session_id ?? null;
  }

  /** Atomically replaces the refresh token and records the old one as retired. */
  async rotate(
    q: Queryable,
    sessionId: string,
    oldHash: Buffer,
    newHash: Buffer,
    ipHash: string | null,
  ): Promise<boolean> {
    const res = await q.query(
      `UPDATE sessions SET refresh_hash = $3, last_used_at = now(), ip_hash = COALESCE($4, ip_hash)
        WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL`,
      [sessionId, oldHash, newHash, ipHash],
    );
    if (res.rowCount !== 1) return false;
    await q.query(`INSERT INTO session_refresh_tokens (token_hash, session_id) VALUES ($1, $2)`, [
      oldHash,
      sessionId,
    ]);
    return true;
  }

  async revoke(q: Queryable, sessionId: string, reason: RevokeReason): Promise<boolean> {
    const res = await q.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
    return res.rowCount === 1;
  }

  async revokeAllForUser(q: Queryable, userId: string, reason: RevokeReason): Promise<string[]> {
    const res = await q.query<{ id: string }>(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [userId, reason],
    );
    return res.rows.map((r) => r.id);
  }

  async listActive(userId: string): Promise<SessionRow[]> {
    const res = await this.db.query<DbSession>(
      `SELECT ${COLUMNS} FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC`,
      [userId],
    );
    return res.rows.map(map);
  }

  async findById(id: string): Promise<SessionRow | null> {
    const res = await this.db.query<DbSession>(`SELECT ${COLUMNS} FROM sessions WHERE id = $1`, [
      id,
    ]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** True when the user has logged in before from this device or network. */
  async hasPriorSessionFrom(
    userId: string,
    deviceId: string | null,
    ipHash: string | null,
  ): Promise<{
    anyPrior: boolean;
    known: boolean;
  }> {
    const res = await this.db.query<{ any_prior: boolean; known: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM sessions WHERE user_id = $1) AS any_prior,
              EXISTS (SELECT 1 FROM sessions WHERE user_id = $1
                        AND ((device_id IS NOT NULL AND device_id = $2) OR (ip_hash IS NOT NULL AND ip_hash = $3))) AS known`,
      [userId, deviceId, ipHash],
    );
    return { anyPrior: res.rows[0]!.any_prior, known: res.rows[0]!.known };
  }

  /** Loads what AuthGuard needs to accept an access token. */
  /** Marks a session as verified with a second factor. */
  async markMfa(q: Queryable, sessionId: string): Promise<void> {
    await q.query(`UPDATE sessions SET mfa_at = now() WHERE id = $1 AND mfa_at IS NULL`, [
      sessionId,
    ]);
  }

  async authState(sessionId: string, userId: string): Promise<SessionAuthState | null> {
    const res = await this.db.query<{
      revoked_at: Date | null;
      expires_at: Date;
      status: UserStatus;
      platform_role: PlatformRole;
      mfa_at: Date | null;
    }>(
      `SELECT s.revoked_at, s.expires_at, u.status, u.platform_role, s.mfa_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2`,
      [sessionId, userId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      sessionRevoked: r.revoked_at !== null,
      sessionExpired: r.expires_at.getTime() <= Date.now(),
      userStatus: r.status,
      platformRole: r.platform_role,
      mfa: r.mfa_at !== null,
    };
  }
}
