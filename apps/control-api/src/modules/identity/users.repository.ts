import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type PlatformRole = 'USER' | 'PLATFORM_ADMIN';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  status: UserStatus;
  platformRole: PlatformRole;
  createdAt: Date;
}

interface DbUser {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  status: UserStatus;
  platform_role: PlatformRole;
  created_at: Date;
}

const COLUMNS = 'id, email, username, password_hash, status, platform_role, created_at';

function map(r: DbUser): UserRow {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    passwordHash: r.password_hash,
    status: r.status,
    platformRole: r.platform_role,
    createdAt: r.created_at,
  };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: Database) {}

  async insert(
    q: Queryable,
    u: { id: string; email: string; username: string; passwordHash: string },
  ): Promise<UserRow> {
    const res = await q.query<DbUser>(
      `INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [u.id, u.email, u.username, u.passwordHash],
    );
    return map(res.rows[0]!);
  }

  /** Finds a user by email or username (both case-insensitive citext). */
  async findByLogin(login: string): Promise<UserRow | null> {
    const res = await this.db.query<DbUser>(
      `SELECT ${COLUMNS} FROM users WHERE email = $1 OR username = $1 LIMIT 1`,
      [login],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<UserRow | null> {
    const res = await q.query<DbUser>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
  }
}
