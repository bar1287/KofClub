import { Injectable } from '@nestjs/common';
import { randomCode, sha256 } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { Database, isUniqueViolation, Queryable } from '../../infra/database/database';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from './club-access.service';
import { ClubRole, decideMemberChange, roleHasPermission } from './club-permissions';
import { ClubRow, ClubsRepository, MembershipRow } from './clubs.repository';
import type {
  CreateClubInput,
  CreateInviteInput,
  ListMembersQuery,
  TransferOwnershipInput,
  UpdateClubInput,
  UpdateMemberInput,
} from './clubs.schemas';
import { ClubDto, InviteDto, MemberDto, toClubDto, toInviteDto, toMemberDto } from './clubs.dto';

export const JOIN_CODE_LENGTH = 8;
export const INVITE_CODE_LENGTH = 12;
const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class ClubsService {
  constructor(
    private readonly db: Database,
    private readonly repo: ClubsRepository,
    private readonly access: ClubAccessService,
    private readonly audit: AuditService,
  ) {}

  async create(auth: AuthContext, input: CreateClubInput, ctx: RequestContext): Promise<ClubDto> {
    for (let attempt = 0; ; attempt++) {
      try {
        const club = await this.db.tx(async (q) => {
          const club = await this.repo.insertClub(q, {
            id: uuidv7(),
            ownerUserId: auth.userId,
            name: input.name,
            description: input.description ?? null,
            joinCode: randomCode(JOIN_CODE_LENGTH),
          });
          await this.repo.insertMembership(q, {
            clubId: club.id,
            userId: auth.userId,
            role: 'OWNER',
            inviteId: null,
          });
          await this.audit.record(q, ctx, {
            action: 'CLUB_CREATED',
            objectType: 'club',
            objectId: club.id,
            clubId: club.id,
            after: { name: club.name, description: club.description },
          });
          return club;
        });
        return toClubDto(club, 'OWNER', { showJoinCode: true, memberCount: 1 });
      } catch (err) {
        // Join-code collisions are astronomically rare but handled explicitly.
        if (isUniqueViolation(err, 'clubs_join_code_key') && attempt < MAX_CODE_ATTEMPTS) continue;
        throw err;
      }
    }
  }

  async listMine(auth: AuthContext): Promise<ClubDto[]> {
    const rows = await this.repo.listClubsForUser(auth.userId);
    return rows.map((r) =>
      toClubDto(r, r.myRole, {
        showJoinCode: roleHasPermission(r.myRole, 'INVITES_MANAGE'),
        memberCount: r.memberCount,
      }),
    );
  }

  async get(auth: AuthContext, clubId: string): Promise<ClubDto> {
    const { club, membership } = await this.access.require(clubId, auth, 'CLUB_VIEW');
    const role = membership?.role ?? null;
    return toClubDto(club, role, {
      showJoinCode: role !== null && roleHasPermission(role, 'INVITES_MANAGE'),
      memberCount: await this.repo.countActiveMembers(clubId),
    });
  }

  /**
   * Joins a club with either the club's join code or an invite code. When
   * expectedClubId is given (POST /clubs/{id}/join) the code must belong to
   * that club.
   */
  async join(
    auth: AuthContext,
    code: string,
    ctx: RequestContext,
    expectedClubId?: string,
  ): Promise<ClubDto> {
    const joined = await this.db.tx(async (q) => {
      let club: ClubRow | null = null;
      let role: ClubRole = 'MEMBER';
      let inviteId: string | null = null;

      if (code.length === JOIN_CODE_LENGTH) club = await this.repo.findClubByJoinCode(q, code);
      if (!club) {
        const invite = await this.repo.findInviteByHash(q, sha256(code));
        if (
          !invite ||
          invite.revokedAt ||
          invite.expiresAt.getTime() <= Date.now() ||
          invite.useCount >= invite.maxUses
        ) {
          throw new AppError('INVITE_INVALID', 'Invalid, expired or used-up code');
        }
        club = await this.repo.findClub(invite.clubId, q);
        role = invite.role;
        inviteId = invite.id;
      }
      if (!club || club.status !== 'ACTIVE' || (expectedClubId && club.id !== expectedClubId)) {
        throw new AppError('INVITE_INVALID', 'Invalid, expired or used-up code');
      }

      const existing = await this.repo.findMembership(club.id, auth.userId, q, true);
      let membership: MembershipRow;
      if (existing?.status === 'ACTIVE')
        throw new AppError('ALREADY_CLUB_MEMBER', 'Already a member of this club');
      if (existing?.status === 'BANNED')
        throw new AppError('CLUB_BANNED', 'You are banned from this club');
      if (existing) {
        membership = await this.repo.updateMembership(q, club.id, auth.userId, {
          role,
          status: 'ACTIVE',
          inviteId,
          rejoin: true,
        });
      } else {
        membership = await this.repo.insertMembership(q, {
          clubId: club.id,
          userId: auth.userId,
          role,
          inviteId,
        });
      }
      if (inviteId) await this.repo.incrementInviteUse(q, inviteId);
      await this.audit.record(q, ctx, {
        action: 'MEMBER_JOINED',
        objectType: 'club_member',
        objectId: auth.userId,
        clubId: club.id,
        after: { role: membership.role, via: inviteId ? 'INVITE' : 'JOIN_CODE', inviteId },
      });
      return { club, membership };
    });
    return toClubDto(joined.club, joined.membership.role, {
      showJoinCode: roleHasPermission(joined.membership.role, 'INVITES_MANAGE'),
    });
  }

  async leave(auth: AuthContext, clubId: string, ctx: RequestContext): Promise<void> {
    await this.db.tx(async (q) => {
      const { membership } = await this.access.require(clubId, auth, 'CLUB_VIEW', q);
      if (!membership) throw new AppError('NOT_CLUB_MEMBER', 'You are not a member of this club');
      if (membership.role === 'OWNER') {
        throw new AppError('ROLE_CHANGE_NOT_ALLOWED', 'The owner cannot leave the club');
      }
      await this.repo.updateMembership(q, clubId, auth.userId, { status: 'LEFT' });
      await this.audit.record(q, ctx, {
        action: 'MEMBER_LEFT',
        objectType: 'club_member',
        objectId: auth.userId,
        clubId,
        before: { role: membership.role, status: membership.status },
      });
    });
  }

  async rotateJoinCode(auth: AuthContext, clubId: string, ctx: RequestContext): Promise<ClubDto> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.tx(async (q) => {
          const { club, membership } = await this.access.require(clubId, auth, 'MEMBERS_MANAGE', q);
          const code = randomCode(JOIN_CODE_LENGTH);
          await this.repo.updateJoinCode(q, clubId, code);
          await this.audit.record(q, ctx, {
            action: 'JOIN_CODE_ROTATED',
            objectType: 'club',
            objectId: clubId,
            clubId,
          });
          return toClubDto({ ...club, joinCode: code }, membership?.role ?? null, {
            showJoinCode: true,
          });
        });
      } catch (err) {
        if (isUniqueViolation(err, 'clubs_join_code_key') && attempt < MAX_CODE_ATTEMPTS) continue;
        throw err;
      }
    }
  }

  /** Renames the club or edits its description (OWNER). */
  async update(
    auth: AuthContext,
    clubId: string,
    input: UpdateClubInput,
    ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.db.tx(async (q) => {
      const { club, membership } = await this.access.require(clubId, auth, 'CLUB_MANAGE', q);
      const updated = await this.repo.updateClub(q, clubId, {
        name: input.name,
        description: input.description,
      });
      await this.audit.record(q, ctx, {
        action: 'CLUB_UPDATED',
        objectType: 'club',
        objectId: clubId,
        clubId,
        before: { name: club.name, description: club.description },
        after: { name: updated.name, description: updated.description },
      });
      return toClubDto(updated, membership?.role ?? null, {
        showJoinCode: true,
        memberCount: await this.repo.countActiveMembers(clubId),
      });
    });
  }

  /**
   * Hands the club to another active member (OWNER only). The previous owner
   * stays on as ADMIN. Exactly one OWNER exists at any time (unique index),
   * so the demotion happens before the promotion inside one transaction.
   */
  async transferOwnership(
    auth: AuthContext,
    clubId: string,
    input: TransferOwnershipInput,
    ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.db.tx(async (q) => {
      await this.repo.findClub(clubId, q, true); // serialize ownership changes
      const { club, membership } = await this.access.require(clubId, auth, 'CLUB_MANAGE', q);
      if (membership?.role !== 'OWNER') {
        throw new AppError('FORBIDDEN', 'Only the club owner can transfer ownership');
      }
      if (input.userId === auth.userId) {
        throw new AppError('VALIDATION_FAILED', 'You already own this club');
      }
      const target = await this.repo.findMembership(clubId, input.userId, q, true);
      if (!target || target.status !== 'ACTIVE') {
        throw new AppError('NOT_FOUND', 'The new owner must be an active member');
      }
      await this.repo.updateMembership(q, clubId, auth.userId, { role: 'ADMIN' });
      await this.repo.updateMembership(q, clubId, input.userId, { role: 'OWNER' });
      const updated = await this.repo.updateClub(q, clubId, { ownerUserId: input.userId });
      await this.audit.record(q, ctx, {
        action: 'CLUB_OWNERSHIP_TRANSFERRED',
        objectType: 'club',
        objectId: clubId,
        clubId,
        before: { ownerUserId: club.ownerUserId, previousTargetRole: target.role },
        after: { ownerUserId: input.userId, previousOwnerRole: 'ADMIN' },
      });
      return toClubDto(updated, 'ADMIN', {
        showJoinCode: true,
        memberCount: await this.repo.countActiveMembers(clubId),
      });
    });
  }

  // --- members ---------------------------------------------------------------

  async listMembers(
    auth: AuthContext,
    clubId: string,
    query: ListMembersQuery,
  ): Promise<Page<MemberDto>> {
    const { membership } = await this.access.require(clubId, auth, 'MEMBERS_VIEW');
    // Regular members only see active members; managers can filter by status.
    const canManage = membership === null || roleHasPermission(membership.role, 'MEMBERS_MANAGE');
    const status = canManage ? query.status : 'ACTIVE';
    const after = decodeCursor(query.cursor, ['joinedAt', 'userId'] as const);
    const rows = await this.repo.listMembers(clubId, query.limit + 1, after, status);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toMemberDto),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ joinedAt: last.joinedAtKey, userId: last.userId })
          : null,
    };
  }

  async updateMember(
    auth: AuthContext,
    clubId: string,
    userId: string,
    input: UpdateMemberInput,
    ctx: RequestContext,
  ): Promise<MemberDto> {
    return this.db.tx(async (q) => {
      const { membership: actor } = await this.access.require(clubId, auth, 'MEMBERS_MANAGE', q);
      if (!actor) throw new AppError('FORBIDDEN', 'Only club staff can manage members');
      const target = await this.repo.findMembership(clubId, userId, q, true);
      if (!target || target.status === 'LEFT') throw new AppError('NOT_FOUND', 'Member not found');
      const decision = decideMemberChange(actor, target, input);
      if (!decision.allowed) throw new AppError('ROLE_CHANGE_NOT_ALLOWED', decision.reason);

      const updated = await this.repo.updateMembership(q, clubId, userId, {
        role: input.role,
        status: input.status,
      });
      await this.audit.record(q, ctx, {
        action:
          input.status === 'BANNED'
            ? 'MEMBER_BANNED'
            : input.status === 'ACTIVE' && target.status === 'BANNED'
              ? 'MEMBER_UNBANNED'
              : 'MEMBER_UPDATED',
        objectType: 'club_member',
        objectId: userId,
        clubId,
        before: { role: target.role, status: target.status },
        after: { role: updated.role, status: updated.status },
      });
      const username = await this.usernameOf(q, userId);
      return toMemberDto({ ...updated, username });
    });
  }

  // --- invites ---------------------------------------------------------------

  async createInvite(
    auth: AuthContext,
    clubId: string,
    input: CreateInviteInput,
    ctx: RequestContext,
  ): Promise<{ invite: InviteDto; code: string }> {
    for (let attempt = 0; ; attempt++) {
      const code = randomCode(INVITE_CODE_LENGTH);
      try {
        const invite = await this.db.tx(async (q) => {
          const { membership } = await this.access.require(clubId, auth, 'INVITES_MANAGE', q);
          if (!membership) throw new AppError('FORBIDDEN', 'Only club staff can create invites');
          if (input.role === 'AGENT' && !roleHasPermission(membership.role, 'MEMBERS_MANAGE')) {
            throw new AppError('ROLE_CHANGE_NOT_ALLOWED', 'Only admins can create agent invites');
          }
          const invite = await this.repo.insertInvite(q, {
            id: uuidv7(),
            clubId,
            createdBy: auth.userId,
            codeHash: sha256(code),
            role: input.role,
            maxUses: input.maxUses,
            expiresAt: new Date(Date.now() + input.expiresInHours * 3600 * 1000),
          });
          await this.audit.record(q, ctx, {
            action: 'INVITE_CREATED',
            objectType: 'club_invite',
            objectId: invite.id,
            clubId,
            after: {
              role: invite.role,
              maxUses: invite.maxUses,
              expiresAt: invite.expiresAt.toISOString(),
            },
          });
          return invite;
        });
        return { invite: toInviteDto(invite), code };
      } catch (err) {
        if (isUniqueViolation(err, 'club_invites_code_hash_key') && attempt < MAX_CODE_ATTEMPTS)
          continue;
        throw err;
      }
    }
  }

  async listInvites(auth: AuthContext, clubId: string): Promise<InviteDto[]> {
    await this.access.require(clubId, auth, 'INVITES_MANAGE');
    return (await this.repo.listInvites(clubId)).map(toInviteDto);
  }

  async revokeInvite(
    auth: AuthContext,
    clubId: string,
    inviteId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.db.tx(async (q) => {
      await this.access.require(clubId, auth, 'INVITES_MANAGE', q);
      const invite = await this.repo.findInvite(clubId, inviteId, q);
      if (!invite) throw new AppError('NOT_FOUND', 'Invite not found');
      if (await this.repo.revokeInvite(q, inviteId)) {
        await this.audit.record(q, ctx, {
          action: 'INVITE_REVOKED',
          objectType: 'club_invite',
          objectId: inviteId,
          clubId,
        });
      }
    });
  }

  private async usernameOf(q: Queryable, userId: string): Promise<string> {
    const res = await q.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [
      userId,
    ]);
    return res.rows[0]?.username ?? '';
  }
}
