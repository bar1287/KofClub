import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type PlatformRole = 'USER' | 'PLATFORM_ADMIN';

export interface UserRow {
  id: string;
  /** Null for accounts created through Telegram (ADR-018). */
  email: string | null;
  username: string;
  /** Null for accounts that sign in with Telegram only. */
  passwordHash: string | null;
  status: UserStatus;
  platformRole: PlatformRole;
  /** The operator world the account lives in; null for KofClub's own (ADR-019). */
  operatorId: string | null;
  createdAt: Date;
}

interface DbUser {
  id: string;
  email: string | null;
  username: string;
  password_hash: string | null;
  status: UserStatus;
  platform_role: PlatformRole;
  operator_id: string | null;
  created_at: Date;
}

const COLUMNS =
  'id, email, username, password_hash, status, platform_role, operator_id, created_at';

function map(r: DbUser): UserRow {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    passwordHash: r.password_hash,
    status: r.status,
    platformRole: r.platform_role,
    operatorId: r.operator_id,
    createdAt: r.created_at,
  };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: Database) {}

  async insert(
    q: Queryable,
    u: {
      id: string;
      email: string | null;
      username: string;
      passwordHash: string | null;
      operatorId?: string | null;
    },
  ): Promise<UserRow> {
    const res = await q.query<DbUser>(
      `INSERT INTO users (id, email, username, password_hash, operator_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [u.id, u.email, u.username, u.passwordHash, u.operatorId ?? null],
    );
    return map(res.rows[0]!);
  }

  /**
   * Finds a KofClub-world user by email or username (both case-insensitive
   * citext). Operator worlds sign in with Telegram only.
   */
  async findByLogin(login: string): Promise<UserRow | null> {
    const res = await this.db.query<DbUser>(
      `SELECT ${COLUMNS} FROM users
        WHERE (email = $1 OR username = $1) AND operator_id IS NULL LIMIT 1`,
      [login],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<UserRow | null> {
    const res = await q.query<DbUser>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async usernameTaken(username: string, q: Queryable = this.db): Promise<boolean> {
    const res = await q.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
    return (res.rowCount ?? 0) > 0;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
  }
}
