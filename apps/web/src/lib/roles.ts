import type { ClubRole } from './types';

const RANK: Record<ClubRole, number> = { OWNER: 4, ADMIN: 3, AGENT: 2, MEMBER: 1 };

/**
 * Mirrors the server's role matrix to decide which controls to *show*.
 * The control API enforces every permission independently.
 */
export function atLeast(role: ClubRole | null | undefined, min: ClubRole): boolean {
  return role !== null && role !== undefined && RANK[role] >= RANK[min];
}
