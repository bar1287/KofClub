import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';

export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  createdAt: string;
  clubCount: number;
  activeSessions: number;
  cursorKey: string;
}

export interface AdminClubRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  ownerUserId: string;
  ownerUsername: string;
  memberCount: number;
  openTables: number;
  createdAt: string;
  cursorKey: string;
}

export interface RiskEventRow {
  id: string;
  subjectUserId: string | null;
  subjectUsername: string | null;
  clubId: string | null;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  featureValues: Record<string, unknown>;
  evidenceRefs: unknown[];
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByUsername: string | null;
  disposition: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED' | null;
  reviewNote: string | null;
  cursorKey: string;
}

export interface PlatformOverview {
  users: { total: number; suspended: number; platformAdmins: number };
  clubs: { total: number; active: number; suspended: number };
  tables: { open: number; seatedPlayers: number };
  hands: { inProgress: number; completedLast24h: number; voidedLast24h: number };
  sessions: { active: number };
  risk: { openEvents: number; highSeverityOpen: number };
  ledger: { invariantViolations: number };
  generatedAt: string;
}

type After = { createdAt: string; id: string } | undefined;

/** Escapes LIKE metacharacters so user input is matched literally. */
function prefix(q: string | undefined): string | null {
  if (!q) return null;
  return `${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapUser = (r: any): AdminUserRow => ({
  id: r.id,
  username: r.username,
  email: r.email,
  status: r.status,
  platformRole: r.platform_role,
  createdAt: (r.created_at as Date).toISOString(),
  clubCount: r.club_count,
  activeSessions: r.active_sessions,
  cursorKey: r.cursor_key,
});

const mapClub = (r: any): AdminClubRow => ({
  id: r.id,
  name: r.name,
  status: r.status,
  ownerUserId: r.owner_user_id,
  ownerUsername: r.owner_username,
  memberCount: r.member_count,
  openTables: r.open_tables,
  createdAt: (r.created_at as Date).toISOString(),
  cursorKey: r.cursor_key,
});

const mapRisk = (r: any): RiskEventRow => ({
  id: r.id,
  subjectUserId: r.subject_user_id,
  subjectUsername: r.subject_username,
  clubId: r.club_id,
  type: r.type,
  severity: r.severity,
  score: r.score,
  featureValues: r.feature_values,
  evidenceRefs: r.evidence_refs,
  createdAt: (r.created_at as Date).toISOString(),
  reviewedAt: r.reviewed_at ? (r.reviewed_at as Date).toISOString() : null,
  reviewedBy: r.reviewed_by,
  reviewedByUsername: r.reviewed_by_username,
  disposition: r.disposition,
  reviewNote: r.review_note,
  cursorKey: r.cursor_key,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const USER_SELECT = `
  SELECT u.id, u.username, u.email, u.status, u.platform_role, u.created_at, u.created_at::text AS cursor_key,
         (SELECT count(*)::int FROM club_members m WHERE m.user_id = u.id AND m.status = 'ACTIVE') AS club_count,
         (SELECT count(*)::int FROM sessions s
           WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
    FROM users u`;

const CLUB_SELECT = `
  SELECT c.id, c.name, c.status, c.owner_user_id, o.username AS owner_username, c.created_at,
         c.created_at::text AS cursor_key,
         (SELECT count(*)::int FROM club_members m WHERE m.club_id = c.id AND m.status = 'ACTIVE') AS member_count,
         (SELECT count(*)::int FROM tables t WHERE t.club_id = c.id AND t.status = 'OPEN') AS open_tables
    FROM clubs c JOIN users o ON o.id = c.owner_user_id`;

const RISK_SELECT = `
  SELECT r.id, r.subject_user_id, su.username AS subject_username, r.club_id, r.type, r.severity, r.score,
         r.feature_values, r.evidence_refs, r.created_at, r.created_at::text AS cursor_key, r.reviewed_at,
         r.reviewed_by, rb.username AS reviewed_by_username, r.disposition, r.review_note
    FROM risk_events r
    LEFT JOIN users su ON su.id = r.subject_user_id
    LEFT JOIN users rb ON rb.id = r.reviewed_by`;

/** Read/write queries for platform administration (spec §12 "Platform admin"). */
@Injectable()
export class AdminRepository {
  constructor(private readonly db: Database) {}

  async overview(): Promise<PlatformOverview> {
    const res = await this.db.query<Record<string, number>>(`
      SELECT
        (SELECT count(*)::int FROM users) AS users_total,
        (SELECT count(*)::int FROM users WHERE status = 'SUSPENDED') AS users_suspended,
        (SELECT count(*)::int FROM users WHERE platform_role = 'PLATFORM_ADMIN') AS users_admins,
        (SELECT count(*)::int FROM clubs) AS clubs_total,
        (SELECT count(*)::int FROM clubs WHERE status = 'ACTIVE') AS clubs_active,
        (SELECT count(*)::int FROM clubs WHERE status = 'SUSPENDED') AS clubs_suspended,
        (SELECT count(*)::int FROM tables WHERE status = 'OPEN') AS tables_open,
        (SELECT count(*)::int FROM table_seats) AS seated,
        (SELECT count(*)::int FROM hands WHERE status = 'IN_PROGRESS') AS hands_live,
        (SELECT count(*)::int FROM hands WHERE status = 'COMPLETED' AND ended_at > now() - interval '24 hours') AS hands_done,
        (SELECT count(*)::int FROM hands WHERE status = 'VOIDED' AND ended_at > now() - interval '24 hours') AS hands_voided,
        (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS sessions_active,
        (SELECT count(*)::int FROM risk_events WHERE reviewed_at IS NULL) AS risk_open,
        (SELECT count(*)::int FROM risk_events WHERE reviewed_at IS NULL AND severity = 'HIGH') AS risk_high,
        (SELECT count(*)::int FROM ledger_invariant_violations) AS ledger_violations`);
    const r = res.rows[0]!;
    return {
      users: {
        total: r.users_total!,
        suspended: r.users_suspended!,
        platformAdmins: r.users_admins!,
      },
      clubs: { total: r.clubs_total!, active: r.clubs_active!, suspended: r.clubs_suspended! },
      tables: { open: r.tables_open!, seatedPlayers: r.seated! },
      hands: {
        inProgress: r.hands_live!,
        completedLast24h: r.hands_done!,
        voidedLast24h: r.hands_voided!,
      },
      sessions: { active: r.sessions_active! },
      risk: { openEvents: r.risk_open!, highSeverityOpen: r.risk_high! },
      ledger: { invariantViolations: r.ledger_violations! },
      generatedAt: new Date().toISOString(),
    };
  }

  async searchUsers(q: string | undefined, limit: number, after: After): Promise<AdminUserRow[]> {
    const res = await this.db.query(
      `${USER_SELECT}
        WHERE ($1::text IS NULL OR lower(u.username::text) LIKE $1 OR lower(u.email::text) LIKE $1)
          AND ($2::timestamptz IS NULL OR (u.created_at, u.id) < ($2::timestamptz, $3::uuid))
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $4`,
      [prefix(q), after?.createdAt ?? null, after?.id ?? null, limit],
    );
    return res.rows.map(mapUser);
  }

  async findUser(
    id: string,
    q: Queryable = this.db,
    forUpdate = false,
  ): Promise<AdminUserRow | null> {
    const res = await q.query(
      `${USER_SELECT} WHERE u.id = $1 ${forUpdate ? 'FOR UPDATE OF u' : ''}`,
      [id],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async setUserStatus(q: Queryable, id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
    await q.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
  }

  async searchClubs(q: string | undefined, limit: number, after: After): Promise<AdminClubRow[]> {
    const res = await this.db.query(
      `${CLUB_SELECT}
        WHERE ($1::text IS NULL OR lower(c.name) LIKE $1)
          AND ($2::timestamptz IS NULL OR (c.created_at, c.id) < ($2::timestamptz, $3::uuid))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $4`,
      [prefix(q), after?.createdAt ?? null, after?.id ?? null, limit],
    );
    return res.rows.map(mapClub);
  }

  async findClub(
    id: string,
    q: Queryable = this.db,
    forUpdate = false,
  ): Promise<AdminClubRow | null> {
    const res = await q.query(
      `${CLUB_SELECT} WHERE c.id = $1 ${forUpdate ? 'FOR UPDATE OF c' : ''}`,
      [id],
    );
    return res.rows[0] ? mapClub(res.rows[0]) : null;
  }

  async setClubStatus(q: Queryable, id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
    await q.query(`UPDATE clubs SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
  }

  async riskEvents(
    status: 'OPEN' | 'REVIEWED',
    limit: number,
    after: After,
  ): Promise<RiskEventRow[]> {
    const res = await this.db.query(
      `${RISK_SELECT}
        WHERE (r.reviewed_at IS NULL) = ($1 = 'OPEN')
          AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $4`,
      [status, after?.createdAt ?? null, after?.id ?? null, limit],
    );
    return res.rows.map(mapRisk);
  }

  async findRisk(
    id: string,
    q: Queryable = this.db,
    forUpdate = false,
  ): Promise<RiskEventRow | null> {
    const res = await q.query(
      `${RISK_SELECT} WHERE r.id = $1 ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
      [id],
    );
    return res.rows[0] ? mapRisk(res.rows[0]) : null;
  }

  async reviewRisk(
    q: Queryable,
    id: string,
    reviewer: string,
    disposition: string,
    note: string,
  ): Promise<void> {
    await q.query(
      `UPDATE risk_events SET reviewed_at = now(), reviewed_by = $2, disposition = $3, review_note = $4
        WHERE id = $1`,
      [id, reviewer, disposition, note],
    );
  }
}
