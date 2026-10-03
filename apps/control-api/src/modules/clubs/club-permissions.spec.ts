import {
  decideMemberChange,
  platformAdminHasPermission,
  roleHasPermission,
} from './club-permissions';

describe('club permissions', () => {
  it('grants permissions by minimum role', () => {
    expect(roleHasPermission('MEMBER', 'CLUB_VIEW')).toBe(true);
    expect(roleHasPermission('MEMBER', 'INVITES_MANAGE')).toBe(false);
    expect(roleHasPermission('AGENT', 'INVITES_MANAGE')).toBe(true);
    expect(roleHasPermission('AGENT', 'MEMBERS_MANAGE')).toBe(false);
    expect(roleHasPermission('ADMIN', 'TABLES_MANAGE')).toBe(true);
    expect(roleHasPermission('ADMIN', 'CHIPS_MANAGE')).toBe(true);
    expect(roleHasPermission('ADMIN', 'CLUB_MANAGE')).toBe(false);
    expect(roleHasPermission('OWNER', 'CLUB_MANAGE')).toBe(true);
  });

  it('gives platform admins read-only oversight', () => {
    expect(platformAdminHasPermission('PLATFORM_ADMIN', 'AUDIT_VIEW')).toBe(true);
    expect(platformAdminHasPermission('PLATFORM_ADMIN', 'CHIPS_MANAGE')).toBe(false);
    expect(platformAdminHasPermission('USER', 'CLUB_VIEW')).toBe(false);
  });
});

describe('decideMemberChange', () => {
  const owner = { userId: 'o', role: 'OWNER' as const };
  const admin = { userId: 'a', role: 'ADMIN' as const };
  const admin2 = { userId: 'a2', role: 'ADMIN' as const };
  const agent = { userId: 'g', role: 'AGENT' as const };
  const member = { userId: 'm', role: 'MEMBER' as const };

  it('owner can promote a member to admin and ban admins', () => {
    expect(decideMemberChange(owner, member, { role: 'ADMIN' }).allowed).toBe(true);
    expect(decideMemberChange(owner, admin, { status: 'BANNED' }).allowed).toBe(true);
  });

  it('admin can manage lower roles but not peers or promote to admin', () => {
    expect(decideMemberChange(admin, member, { status: 'BANNED' }).allowed).toBe(true);
    expect(decideMemberChange(admin, member, { role: 'AGENT' }).allowed).toBe(true);
    expect(decideMemberChange(admin, member, { role: 'ADMIN' }).allowed).toBe(false);
    expect(decideMemberChange(admin, admin2, { status: 'BANNED' }).allowed).toBe(false);
  });

  it('nobody can modify the owner or themselves', () => {
    expect(decideMemberChange(admin, owner, { status: 'BANNED' }).allowed).toBe(false);
    expect(decideMemberChange(owner, owner, { role: 'MEMBER' }).allowed).toBe(false);
  });

  it('agents and members cannot manage members', () => {
    expect(decideMemberChange(agent, member, { status: 'BANNED' }).allowed).toBe(false);
    expect(decideMemberChange(member, agent, { status: 'BANNED' }).allowed).toBe(false);
  });
});
