import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { Database } from '../../infra/database/database';
import { AuditRecordDto, AuditService } from '../audit/audit.service';
import { SessionRevocationPublisher } from '../identity/session-revocation.publisher';
import { SessionsRepository } from '../identity/sessions.repository';
import {
  AdminClubRow,
  AdminRepository,
  AdminUserRow,
  PlatformOverview,
  RiskEventRow,
} from './admin.repository';
import type {
  AdminAuditQuery,
  ReviewRiskInput,
  RiskQuery,
  SearchQuery,
  UpdateClubStatusInput,
  UpdateUserStatusInput,
} from './admin.schemas';

type Dto<T> = Omit<T, 'cursorKey'>;

function strip<T extends { cursorKey: string }>(row: T): Dto<T> {
  const { cursorKey: _c, ...dto } = row;
  return dto;
}

function page<T extends { cursorKey: string; id: string }>(rows: T[], limit: number): Page<Dto<T>> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(strip),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ createdAt: last.cursorKey, id: last.id }) : null,
  };
}

/**
 * Platform administration (spec §12): account and club search, suspension,
 * platform-wide audit queries, risk-case review and an operational overview.
 * Every mutation is audited. Platform admins never move chips or see
 * unrevealed cards (ADR-006, ADR-008).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly repo: AdminRepository,
    private readonly audit: AuditService,
    private readonly sessions: SessionsRepository,
    private readonly revocations: SessionRevocationPublisher,
  ) {}

  overview(): Promise<PlatformOverview> {
    return this.repo.overview();
  }

  async users(query: SearchQuery): Promise<Page<Dto<AdminUserRow>>> {
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    return page(await this.repo.searchUsers(query.q, query.limit + 1, after), query.limit);
  }

  /**
   * Suspends or reinstates an account. Suspension revokes every session at
   * once (HTTP requests fail immediately; live WebSocket connections are
   * closed through the revocation channel). Seated chips stay on the table
   * and are returned to the wallet by the normal leave/timeout flow.
   */
  async setUserStatus(
    auth: AuthContext,
    userId: string,
    input: UpdateUserStatusInput,
    ctx: RequestContext,
  ): Promise<Dto<AdminUserRow>> {
    if (userId === auth.userId) {
      throw new AppError('VALIDATION_FAILED', 'You cannot change your own account status');
    }
    const revoked = await this.db.tx(async (q) => {
      const user = await this.repo.findUser(userId, q, true);
      if (!user || user.status === 'DELETED') throw new AppError('NOT_FOUND', 'User not found');
      if (user.platformRole === 'PLATFORM_ADMIN') {
        throw new AppError('FORBIDDEN', 'Platform administrators are managed out of band');
      }
      if (user.status === input.status) return [];
      await this.repo.setUserStatus(q, userId, input.status);
      const sessionIds =
        input.status === 'SUSPENDED'
          ? await this.sessions.revokeAllForUser(q, userId, 'ACCOUNT_SUSPENDED')
          : [];
      await this.audit.record(q, ctx, {
        action: input.status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REINSTATED',
        objectType: 'user',
        objectId: userId,
        before: { status: user.status },
        after: { status: input.status, reason: input.reason, revokedSessions: sessionIds.length },
      });
      return sessionIds;
    });
    if (revoked.length) await this.revocations.publish(revoked);
    return strip((await this.repo.findUser(userId))!);
  }

  async clubs(query: SearchQuery): Promise<Page<Dto<AdminClubRow>>> {
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    return page(await this.repo.searchClubs(query.q, query.limit + 1, after), query.limit);
  }

  /**
   * Suspending a club makes it view-only: no new seats, tables, chip
   * movements or membership changes. Hands in progress finish and players
   * can always leave (chips return to their wallets).
   */
  async setClubStatus(
    clubId: string,
    input: UpdateClubStatusInput,
    ctx: RequestContext,
  ): Promise<Dto<AdminClubRow>> {
    await this.db.tx(async (q) => {
      const club = await this.repo.findClub(clubId, q, true);
      if (!club || club.status === 'CLOSED') throw new AppError('CLUB_NOT_FOUND', 'Club not found');
      if (club.status === input.status) return;
      await this.repo.setClubStatus(q, clubId, input.status);
      await this.audit.record(q, ctx, {
        action: input.status === 'SUSPENDED' ? 'CLUB_SUSPENDED' : 'CLUB_REINSTATED',
        objectType: 'club',
        objectId: clubId,
        clubId,
        before: { status: club.status },
        after: { status: input.status, reason: input.reason },
      });
    });
    return strip((await this.repo.findClub(clubId))!);
  }

  auditLog(query: AdminAuditQuery): Promise<Page<AuditRecordDto>> {
    return this.audit.list(
      { clubId: query.clubId, actorUserId: query.actorUserId, action: query.action },
      query.limit,
      query.cursor,
    );
  }

  async riskEvents(query: RiskQuery): Promise<Page<Dto<RiskEventRow>>> {
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    return page(await this.repo.riskEvents(query.status, query.limit + 1, after), query.limit);
  }

  /**
   * Records a reviewer's disposition. Evidence stays immutable (database
   * trigger); enforcement such as suspension is a separate, explicit action
   * (spec §11: no automatic bans from a single heuristic).
   */
  async reviewRisk(
    auth: AuthContext,
    id: string,
    input: ReviewRiskInput,
    ctx: RequestContext,
  ): Promise<Dto<RiskEventRow>> {
    await this.db.tx(async (q) => {
      const event = await this.repo.findRisk(id, q, true);
      if (!event) throw new AppError('NOT_FOUND', 'Risk event not found');
      if (event.reviewedAt) throw new AppError('CONFLICT', 'Risk event was already reviewed');
      await this.repo.reviewRisk(q, id, auth.userId, input.disposition, input.note);
      await this.audit.record(q, ctx, {
        action: 'RISK_EVENT_REVIEWED',
        objectType: 'risk_event',
        objectId: id,
        clubId: event.clubId,
        after: { disposition: input.disposition, note: input.note },
      });
    });
    return strip((await this.repo.findRisk(id))!);
  }
}
