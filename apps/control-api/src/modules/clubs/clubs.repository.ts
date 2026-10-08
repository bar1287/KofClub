import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import type { ClubRole, MemberStatus } from './club-permissions';

export type ClubStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface ClubRow {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  joinCode: string;
  status: ClubStatus;
  /** Players can chat and send reactions at the club's tables. */
  tableChat: boolean;
  createdAt: Date;
}

export interface MembershipRow {
  clubId: string;
  userId: string;
  role: ClubRole;
  status: MemberStatus;
  joinedAt: Date;
}

export interface MemberListRow extends MembershipRow {
  username: string;
  /** Full-precision timestamp text for keyset cursors (JS Dates drop microseconds). */
  joinedAtKey: string;
}

export interface InviteRow {
  id: string;
  clubId: string;
  createdBy: string;
  role: 'MEMBER' | 'AGENT';
  maxUses: number;
  useCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const CLUB_COLS =
  'c.id, c.owner_user_id, c.name, c.description, c.join_code, c.status, c.table_chat, c.created_at';
const INVITE_COLS =
  'id, club_id, created_by, role, max_uses, use_count, expires_at, revoked_at, created_at';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapClub = (r: any): ClubRow => ({
  id: r.id,
  ownerUserId: r.owner_user_id,
  name: r.name,
  description: r.description,
  joinCode: r.join_code,
  status: r.status,
  tableChat: r.table_chat,
  createdAt: r.created_at,
});
const mapMembership = (r: any): MembershipRow => ({
  clubId: r.club_id,
  userId: r.user_id,
  role: r.role,
  status: r.status,
  joinedAt: r.joined_at,
});
const mapInvite = (r: any): InviteRow => ({
  id: r.id,
  clubId: r.club_id,
  createdBy: r.created_by,
  role: r.role,
  maxUses: r.max_uses,
  useCount: r.use_count,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Data access for clubs, memberships and invites (owned by the clubs module). */
@Injectable()
export class ClubsRepository {
  constructor(private readonly db: Database) {}

  async insertClub(
    q: Queryable,
    c: {
      id: string;
      ownerUserId: string;
      name: string;
      description: string | null;
      joinCode: string;
    },
  ): Promise<ClubRow> {
    const res = await q.query(
      `INSERT INTO clubs AS c (id, owner_user_id, name, description, join_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${CLUB_COLS}`,
      [c.id, c.ownerUserId, c.name, c.description, c.joinCode],
    );
    return mapClub(res.rows[0]);
  }

  async findClub(id: string, q: Queryable = this.db, forUpdate = false): Promise<ClubRow | null> {
    const res = await q.query(
      `SELECT ${CLUB_COLS} FROM clubs c WHERE c.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return res.rows[0] ? mapClub(res.rows[0]) : null;
  }

  async findClubByJoinCode(q: Queryable, code: string): Promise<ClubRow | null> {
    const res = await q.query(`SELECT ${CLUB_COLS} FROM clubs c WHERE c.join_code = $1`, [code]);
    return res.rows[0] ? mapClub(res.rows[0]) : null;
  }

  async updateClub(
    q: Queryable,
    clubId: string,
    patch: {
      name?: string;
      description?: string | null;
      ownerUserId?: string;
      tableChat?: boolean;
    },
  ): Promise<ClubRow> {
    const res = await q.query(
      `UPDATE clubs AS c
          SET name = COALESCE($2, c.name),
              description = CASE WHEN $3::boolean THEN $4 ELSE c.description END,
              owner_user_id = COALESCE($5, c.owner_user_id),
              table_chat = COALESCE($6, c.table_chat),
              updated_at = now()
        WHERE c.id = $1
        RETURNING ${CLUB_COLS}`,
      [
        clubId,
        patch.name ?? null,
        patch.description !== undefined,
        patch.description ?? null,
        patch.ownerUserId ?? null,
        patch.tableChat ?? null,
      ],
    );
    return mapClub(res.rows[0]);
  }

  async updateJoinCode(q: Queryable, clubId: string, code: string): Promise<void> {
    await q.query(`UPDATE clubs SET join_code = $2 WHERE id = $1`, [clubId, code]);
  }

  async listClubsForUser(
    userId: string,
  ): Promise<Array<ClubRow & { myRole: ClubRole; memberCount: number }>> {
    const res = await this.db.query(
      `SELECT ${CLUB_COLS}, m.role AS my_role,
              (SELECT count(*)::int FROM club_members x WHERE x.club_id = c.id AND x.status = 'ACTIVE') AS member_count
         FROM club_members m JOIN clubs c ON c.id = m.club_id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND c.status <> 'CLOSED'
        ORDER BY c.created_at`,
      [userId],
    );
    return res.rows.map((r) => ({
      ...mapClub(r),
      myRole: r.my_role as ClubRole,
      memberCount: r.member_count as number,
    }));
  }

  async countActiveMembers(clubId: string): Promise<number> {
    const res = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM club_members WHERE club_id = $1 AND status = 'ACTIVE'`,
      [clubId],
    );
    return res.rows[0]!.n;
  }

  // --- memberships -------------------------------------------------------

  async findMembership(
    clubId: string,
    userId: string,
    q: Queryable = this.db,
    forUpdate = false,
  ): Promise<MembershipRow | null> {
    const res = await q.query(
      `SELECT club_id, user_id, role, status, joined_at FROM club_members
        WHERE club_id = $1 AND user_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
      [clubId, userId],
    );
    return res.rows[0] ? mapMembership(res.rows[0]) : null;
  }

  async insertMembership(
    q: Queryable,
    m: { clubId: string; userId: string; role: ClubRole; inviteId: string | null },
  ): Promise<MembershipRow> {
    const res = await q.query(
      `INSERT INTO club_members (club_id, user_id, role, invite_id) VALUES ($1, $2, $3, $4)
       RETURNING club_id, user_id, role, status, joined_at`,
      [m.clubId, m.userId, m.role, m.inviteId],
    );
    return mapMembership(res.rows[0]);
  }

  async updateMembership(
    q: Queryable,
    clubId: string,
    userId: string,
    patch: { role?: ClubRole; status?: MemberStatus; inviteId?: string | null; rejoin?: boolean },
  ): Promise<MembershipRow> {
    const res = await q.query(
      `UPDATE club_members
          SET role = COALESCE($3, role),
              status = COALESCE($4, status),
              invite_id = CASE WHEN $5::boolean THEN $6::uuid ELSE invite_id END,
              joined_at = CASE WHEN $5::boolean THEN now() ELSE joined_at END
        WHERE club_id = $1 AND user_id = $2
        RETURNING club_id, user_id, role, status, joined_at`,
      [
        clubId,
        userId,
        patch.role ?? null,
        patch.status ?? null,
        patch.rejoin ?? false,
        patch.inviteId ?? null,
      ],
    );
    return mapMembership(res.rows[0]);
  }

  async listMembers(
    clubId: string,
    limit: number,
    after?: { joinedAt: string; userId: string },
    status?: MemberStatus,
  ): Promise<MemberListRow[]> {
    const params: unknown[] = [clubId];
    const where = ['m.club_id = $1'];
    if (status) {
      params.push(status);
      where.push(`m.status = $${params.length}`);
    }
    if (after) {
      params.push(after.joinedAt, after.userId);
      where.push(
        `(m.joined_at, m.user_id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit);
    const res = await this.db.query(
      `SELECT m.club_id, m.user_id, m.role, m.status, m.joined_at, m.joined_at::text AS joined_at_key, u.username
         FROM club_members m JOIN users u ON u.id = m.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.joined_at, m.user_id
        LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((r) => ({
      ...mapMembership(r),
      username: r.username as string,
      joinedAtKey: r.joined_at_key as string,
    }));
  }

  // --- invites -------------------------------------------------------------

  async insertInvite(
    q: Queryable,
    i: {
      id: string;
      clubId: string;
      createdBy: string;
      codeHash: Buffer;
      role: 'MEMBER' | 'AGENT';
      maxUses: number;
      expiresAt: Date;
    },
  ): Promise<InviteRow> {
    const res = await q.query(
      `INSERT INTO club_invites (id, club_id, created_by, code_hash, role, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${INVITE_COLS}`,
      [i.id, i.clubId, i.createdBy, i.codeHash, i.role, i.maxUses, i.expiresAt],
    );
    return mapInvite(res.rows[0]);
  }

  async findInviteByHash(q: Queryable, codeHash: Buffer): Promise<InviteRow | null> {
    const res = await q.query(
      `SELECT ${INVITE_COLS} FROM club_invites WHERE code_hash = $1 FOR UPDATE`,
      [codeHash],
    );
    return res.rows[0] ? mapInvite(res.rows[0]) : null;
  }

  async findInvite(
    clubId: string,
    inviteId: string,
    q: Queryable = this.db,
  ): Promise<InviteRow | null> {
    const res = await q.query(
      `SELECT ${INVITE_COLS} FROM club_invites WHERE club_id = $1 AND id = $2`,
      [clubId, inviteId],
    );
    return res.rows[0] ? mapInvite(res.rows[0]) : null;
  }

  async incrementInviteUse(q: Queryable, inviteId: string): Promise<void> {
    await q.query(`UPDATE club_invites SET use_count = use_count + 1 WHERE id = $1`, [inviteId]);
  }

  async revokeInvite(q: Queryable, inviteId: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE club_invites SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [inviteId],
    );
    return res.rowCount === 1;
  }

  async listInvites(clubId: string): Promise<InviteRow[]> {
    const res = await this.db.query(
      `SELECT ${INVITE_COLS} FROM club_invites WHERE club_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [clubId],
    );
    return res.rows.map(mapInvite);
  }
}
