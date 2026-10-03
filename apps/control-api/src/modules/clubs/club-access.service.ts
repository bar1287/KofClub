import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/request-context';
import { Queryable } from '../../infra/database/database';
import { ClubPermission, platformAdminHasPermission, roleHasPermission } from './club-permissions';
import { ClubRow, ClubsRepository, MembershipRow } from './clubs.repository';

export interface ClubAccess {
  club: ClubRow;
  /** Null when access is granted through platform-admin oversight. */
  membership: MembershipRow | null;
}

/**
 * Central tenant-isolation check. Every club-scoped query/command calls
 * this first (spec §9 "Object auth"); other modules depend on it rather
 * than re-implementing membership rules.
 */
@Injectable()
export class ClubAccessService {
  constructor(private readonly repo: ClubsRepository) {}

  async require(
    clubId: string,
    auth: AuthContext,
    permission: ClubPermission,
    q?: Queryable,
  ): Promise<ClubAccess> {
    const club = await this.repo.findClub(clubId, q);
    if (!club || club.status === 'CLOSED') throw new AppError('CLUB_NOT_FOUND', 'Club not found');

    const membership = await this.repo.findMembership(clubId, auth.userId, q);
    if (membership?.status === 'ACTIVE') {
      if (
        club.status === 'SUSPENDED' &&
        permission !== 'CLUB_VIEW' &&
        permission !== 'MEMBERS_VIEW'
      ) {
        throw new AppError('FORBIDDEN', 'Club is suspended');
      }
      if (!roleHasPermission(membership.role, permission)) {
        throw new AppError('FORBIDDEN', 'Insufficient club role', { required: permission });
      }
      return { club, membership };
    }
    if (platformAdminHasPermission(auth.platformRole, permission))
      return { club, membership: null };
    if (membership?.status === 'BANNED')
      throw new AppError('CLUB_BANNED', 'You are banned from this club');
    throw new AppError('NOT_CLUB_MEMBER', 'You are not a member of this club');
  }
}
