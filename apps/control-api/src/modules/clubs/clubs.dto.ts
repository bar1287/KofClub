import type { ClubRole, MemberStatus } from './club-permissions';
import type { ClubRow, InviteRow, MembershipRow } from './clubs.repository';

export interface ClubDto {
  id: string;
  name: string;
  description: string | null;
  status: ClubRow['status'];
  ownerUserId: string;
  createdAt: string;
  myRole: ClubRole | null;
  memberCount?: number;
  /** Only visible to roles that can invite (AGENT and above). */
  joinCode?: string;
}

export interface MemberDto {
  userId: string;
  username: string;
  role: ClubRole;
  status: MemberStatus;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  clubId: string;
  role: 'MEMBER' | 'AGENT';
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'REVOKED';
}

export function toClubDto(
  c: ClubRow,
  myRole: ClubRole | null,
  opts: { showJoinCode: boolean; memberCount?: number },
): ClubDto {
  const dto: ClubDto = {
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    ownerUserId: c.ownerUserId,
    createdAt: c.createdAt.toISOString(),
    myRole,
  };
  if (opts.memberCount !== undefined) dto.memberCount = opts.memberCount;
  if (opts.showJoinCode) dto.joinCode = c.joinCode;
  return dto;
}

export function toMemberDto(m: MembershipRow & { username: string }): MemberDto {
  return {
    userId: m.userId,
    username: m.username,
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt.toISOString(),
  };
}

export function inviteStatus(i: InviteRow, now = Date.now()): InviteDto['status'] {
  if (i.revokedAt) return 'REVOKED';
  if (i.expiresAt.getTime() <= now) return 'EXPIRED';
  if (i.useCount >= i.maxUses) return 'EXHAUSTED';
  return 'ACTIVE';
}

export function toInviteDto(i: InviteRow): InviteDto {
  return {
    id: i.id,
    clubId: i.clubId,
    role: i.role,
    maxUses: i.maxUses,
    useCount: i.useCount,
    expiresAt: i.expiresAt.toISOString(),
    revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
    status: inviteStatus(i),
  };
}
