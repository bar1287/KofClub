import type { PlatformRole } from '../../common/request-context';

export type ClubRole = 'OWNER' | 'ADMIN' | 'AGENT' | 'MEMBER';
export type MemberStatus = 'ACTIVE' | 'BANNED' | 'LEFT';

export const ROLE_RANK: Record<ClubRole, number> = { OWNER: 4, ADMIN: 3, AGENT: 2, MEMBER: 1 };

export type ClubPermission =
  | 'CLUB_VIEW'
  | 'MEMBERS_VIEW'
  | 'INVITES_MANAGE'
  | 'MEMBERS_MANAGE'
  | 'TABLES_MANAGE'
  | 'CHIPS_MANAGE'
  | 'LEDGER_VIEW'
  | 'AUDIT_VIEW'
  | 'HANDS_VIEW'
  | 'CLUB_MANAGE';

/** Minimum club role required for each permission (spec §9 RBAC). */
const MINIMUM_ROLE: Record<ClubPermission, ClubRole> = {
  CLUB_VIEW: 'MEMBER',
  MEMBERS_VIEW: 'MEMBER',
  INVITES_MANAGE: 'AGENT',
  MEMBERS_MANAGE: 'ADMIN',
  TABLES_MANAGE: 'ADMIN',
  CHIPS_MANAGE: 'ADMIN',
  LEDGER_VIEW: 'ADMIN',
  AUDIT_VIEW: 'ADMIN',
  // Club-wide hand history (public record only, ADR-008).
  HANDS_VIEW: 'ADMIN',
  CLUB_MANAGE: 'OWNER',
};

/** Read-only oversight granted to platform administrators in every club. */
const PLATFORM_ADMIN_PERMISSIONS: ReadonlySet<ClubPermission> = new Set([
  'CLUB_VIEW',
  'MEMBERS_VIEW',
  'LEDGER_VIEW',
  'AUDIT_VIEW',
  'HANDS_VIEW',
]);

export function roleHasPermission(role: ClubRole, permission: ClubPermission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MINIMUM_ROLE[permission]];
}

export function platformAdminHasPermission(
  role: PlatformRole,
  permission: ClubPermission,
): boolean {
  return role === 'PLATFORM_ADMIN' && PLATFORM_ADMIN_PERMISSIONS.has(permission);
}

export interface MemberChange {
  role?: Exclude<ClubRole, 'OWNER'>;
  status?: Exclude<MemberStatus, 'LEFT'>;
}

export type MemberChangeDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Role/status change rules:
 * - nobody changes their own membership through this path;
 * - the owner cannot be modified (ownership transfer is a separate flow);
 * - an actor may only modify members ranked strictly below them;
 * - an actor may only assign roles ranked strictly below their own.
 */
export function decideMemberChange(
  actor: { userId: string; role: ClubRole },
  target: { userId: string; role: ClubRole },
  change: MemberChange,
): MemberChangeDecision {
  if (!roleHasPermission(actor.role, 'MEMBERS_MANAGE')) {
    return { allowed: false, reason: 'Missing MEMBERS_MANAGE permission' };
  }
  if (actor.userId === target.userId)
    return { allowed: false, reason: 'Cannot modify your own membership' };
  if (target.role === 'OWNER')
    return { allowed: false, reason: 'The club owner cannot be modified' };
  if (ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) {
    return { allowed: false, reason: 'Target member has an equal or higher role' };
  }
  if (change.role && ROLE_RANK[change.role] >= ROLE_RANK[actor.role]) {
    return { allowed: false, reason: 'Cannot assign a role equal to or above your own' };
  }
  return { allowed: true };
}
