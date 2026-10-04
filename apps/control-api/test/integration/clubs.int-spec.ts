import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { enrollMfa } from './support/mfa';

describe('clubs (integration)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let clubId: string;
  let joinCode: string;

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, bob, carol, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'bob'),
      registerUser(ctx.app, 'carol'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const res = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Friday Night', description: 'Home game' })
      .expect(201);
    expectSchema('Club', res.body);
    clubId = res.body.id;
    joinCode = res.body.joinCode;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('creator becomes OWNER and sees the join code', async () => {
    const res = await as(ctx.app, owner).get(`/v1/clubs/${clubId}`).expect(200);
    expect(res.body).toMatchObject({
      name: 'Friday Night',
      myRole: 'OWNER',
      memberCount: 1,
      ownerUserId: owner.id,
    });
    expect(res.body.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    const mine = await as(ctx.app, owner).get('/v1/clubs').expect(200);
    expectSchema('ClubList', mine.body);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toContain(clubId);
  });

  it('members join with the club code (case/format-insensitive) exactly once', async () => {
    const typed = `${joinCode.slice(0, 4).toLowerCase()}-${joinCode.slice(4)}`;
    const res = await as(ctx.app, bob).post('/v1/clubs/join').send({ code: typed }).expect(200);
    expect(res.body).toMatchObject({ id: clubId, myRole: 'MEMBER' });
    expect(res.body.joinCode).toBeUndefined();
    const again = await as(ctx.app, bob)
      .post(`/v1/clubs/${clubId}/join`)
      .send({ code: joinCode })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_CLUB_MEMBER');
  });

  it('enforces tenant isolation', async () => {
    const notMember = await as(ctx.app, outsider).get(`/v1/clubs/${clubId}`).expect(403);
    expect(notMember.body.error.code).toBe('NOT_CLUB_MEMBER');
    await as(ctx.app, outsider).get(`/v1/clubs/${clubId}/members`).expect(403);
    const missing = await as(ctx.app, owner).get(`/v1/clubs/${randomUUID()}`).expect(404);
    expect(missing.body.error.code).toBe('CLUB_NOT_FOUND');
    await as(ctx.app, owner).get('/v1/clubs/not-a-uuid').expect(400);

    // An owner of another club gains nothing here.
    const other = await as(ctx.app, outsider)
      .post('/v1/clubs')
      .send({ name: 'Other Club' })
      .expect(201);
    await as(ctx.app, owner).get(`/v1/clubs/${other.body.id}/members`).expect(403);
    await as(ctx.app, outsider)
      .patch(`/v1/clubs/${clubId}/members/${bob.id}`)
      .send({ status: 'BANNED' })
      .expect(403);
  });

  it('single-use invites assign their role and cannot be reused or used for another club', async () => {
    const created = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/invites`)
      .send({ role: 'AGENT', maxUses: 1, expiresInHours: 1 })
      .expect(201);
    expectSchema('InviteCreated', created.body);
    const code: string = created.body.code;

    const otherClub = await as(ctx.app, outsider)
      .post('/v1/clubs')
      .send({ name: 'Third Club' })
      .expect(201);
    const wrongClub = await as(ctx.app, carol)
      .post(`/v1/clubs/${otherClub.body.id}/join`)
      .send({ code })
      .expect(404);
    expect(wrongClub.body.error.code).toBe('INVITE_INVALID');

    const joined = await as(ctx.app, carol)
      .post(`/v1/clubs/${clubId}/join`)
      .send({ code })
      .expect(200);
    expect(joined.body.myRole).toBe('AGENT');

    const reuse = await as(ctx.app, outsider).post('/v1/clubs/join').send({ code }).expect(404);
    expect(reuse.body.error.code).toBe('INVITE_INVALID');

    const list = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/invites`).expect(200);
    expectSchema('InviteList', list.body);
    expect(list.body.items[0]).toMatchObject({ useCount: 1, status: 'EXHAUSTED' });
    expect(JSON.stringify(list.body)).not.toContain(code);
  });

  it('agents may invite members but members may not invite; revoked invites stop working', async () => {
    await as(ctx.app, bob).post(`/v1/clubs/${clubId}/invites`).send({}).expect(403);
    const agentInvite = await as(ctx.app, carol)
      .post(`/v1/clubs/${clubId}/invites`)
      .send({ role: 'AGENT' })
      .expect(403);
    expect(agentInvite.body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
    const inv = await as(ctx.app, carol)
      .post(`/v1/clubs/${clubId}/invites`)
      .send({ maxUses: 5 })
      .expect(201);
    await as(ctx.app, carol)
      .delete(`/v1/clubs/${clubId}/invites/${inv.body.invite.id}`)
      .expect(204);
    const res = await as(ctx.app, outsider)
      .post('/v1/clubs/join')
      .send({ code: inv.body.code })
      .expect(404);
    expect(res.body.error.code).toBe('INVITE_INVALID');
  });

  it('paginates members with a keyset cursor', async () => {
    const page1 = await as(ctx.app, bob).get(`/v1/clubs/${clubId}/members?limit=2`).expect(200);
    expectSchema('MemberPage', page1.body);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await as(ctx.app, bob)
      .get(`/v1/clubs/${clubId}/members?limit=2&cursor=${page1.body.nextCursor}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    const all = [...page1.body.items, ...page2.body.items].map(
      (m: { username: string }) => m.username,
    );
    expect(all).toEqual([owner.username, bob.username, carol.username]);
    await as(ctx.app, bob).get(`/v1/clubs/${clubId}/members?cursor=garbage`).expect(400);
  });

  it('applies role hierarchy to role changes and bans', async () => {
    // Members cannot manage members.
    const denied = await as(ctx.app, bob)
      .patch(`/v1/clubs/${clubId}/members/${carol.id}`)
      .send({ status: 'BANNED' })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    // Owner promotes Bob to ADMIN.
    const promoted = await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}/members/${bob.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
    expectSchema('Member', promoted.body);
    expect(promoted.body.role).toBe('ADMIN');

    // Admin cannot touch the owner nor create another admin.
    const ownerBan = await as(ctx.app, bob)
      .patch(`/v1/clubs/${clubId}/members/${owner.id}`)
      .send({ status: 'BANNED' })
      .expect(403);
    expect(ownerBan.body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
    await as(ctx.app, bob)
      .patch(`/v1/clubs/${clubId}/members/${carol.id}`)
      .send({ role: 'ADMIN' })
      .expect(403);

    // Admin bans Carol (an agent).
    const banned = await as(ctx.app, bob)
      .patch(`/v1/clubs/${clubId}/members/${carol.id}`)
      .send({ status: 'BANNED' })
      .expect(200);
    expect(banned.body.status).toBe('BANNED');
    expect((await as(ctx.app, carol).get(`/v1/clubs/${clubId}`).expect(403)).body.error.code).toBe(
      'CLUB_BANNED',
    );
    expect(
      (await as(ctx.app, carol).post('/v1/clubs/join').send({ code: joinCode }).expect(403)).body
        .error.code,
    ).toBe('CLUB_BANNED');
    const mine = await as(ctx.app, carol).get('/v1/clubs').expect(200);
    expect(mine.body.items.map((c: { id: string }) => c.id)).not.toContain(clubId);

    // Regular listing hides banned members; staff can filter for them.
    const visible = await as(ctx.app, bob)
      .get(`/v1/clubs/${clubId}/members?status=BANNED`)
      .expect(200);
    expect(visible.body.items.map((m: { userId: string }) => m.userId)).toEqual([carol.id]);
  });

  it('records privileged actions in the audit log, visible to admins only', async () => {
    const res = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/audit-log?limit=100`).expect(200);
    expectSchema('AuditPage', res.body);
    const actions = res.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CLUB_CREATED',
        'MEMBER_JOINED',
        'INVITE_CREATED',
        'INVITE_REVOKED',
        'MEMBER_UPDATED',
        'MEMBER_BANNED',
      ]),
    );
    const ban = res.body.items.find((a: { action: string }) => a.action === 'MEMBER_BANNED');
    expect(ban).toMatchObject({
      actorUserId: bob.id,
      objectId: carol.id,
      before: { status: 'ACTIVE' },
      after: { status: 'BANNED' },
    });
    expect(ban.requestId).toMatch(/^req_/);

    // Audit rows are immutable at the database level.
    await expect(
      ctx.db.query(`UPDATE audit_log SET action = 'X' WHERE id = $1`, [ban.id]),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.db.query(`DELETE FROM audit_log WHERE id = $1`, [ban.id])).rejects.toThrow(
      /append-only/,
    );

    const member = await registerUser(ctx.app, 'dave');
    await as(ctx.app, member).post('/v1/clubs/join').send({ code: joinCode }).expect(200);
    await as(ctx.app, member).get(`/v1/clubs/${clubId}/audit-log`).expect(403);
  });

  it('platform admins get read-only oversight', async () => {
    const admin = await registerUser(ctx.app, 'padmin');
    await ctx.db.query(`UPDATE users SET platform_role = 'PLATFORM_ADMIN' WHERE id = $1`, [
      admin.id,
    ]);
    // Oversight needs a session verified with a second factor (ADR-017).
    const denied = await as(ctx.app, admin).get(`/v1/clubs/${clubId}`).expect(403);
    expect(denied.body.error.code).toBe('MFA_REQUIRED');
    await enrollMfa(ctx.app, admin);
    const club = await as(ctx.app, admin).get(`/v1/clubs/${clubId}`).expect(200);
    expect(club.body.myRole).toBeNull();
    expect(club.body.joinCode).toBeUndefined();
    await as(ctx.app, admin).get(`/v1/clubs/${clubId}/audit-log`).expect(200);
    await as(ctx.app, admin).post(`/v1/clubs/${clubId}/invites`).send({}).expect(403);
  });

  it('rotating the join code invalidates the old one', async () => {
    const rotated = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/join-code/rotate`)
      .expect(200);
    expect(rotated.body.joinCode).not.toBe(joinCode);
    const late = await registerUser(ctx.app, 'late');
    expect(
      (await as(ctx.app, late).post('/v1/clubs/join').send({ code: joinCode }).expect(404)).body
        .error.code,
    ).toBe('INVITE_INVALID');
    await as(ctx.app, late)
      .post('/v1/clubs/join')
      .send({ code: rotated.body.joinCode })
      .expect(200);
    joinCode = rotated.body.joinCode;
  });

  it('members can leave and rejoin; owners cannot leave', async () => {
    const eve = await registerUser(ctx.app, 'eve');
    await as(ctx.app, eve).post('/v1/clubs/join').send({ code: joinCode }).expect(200);
    await as(ctx.app, eve).post(`/v1/clubs/${clubId}/leave`).expect(204);
    await as(ctx.app, eve).get(`/v1/clubs/${clubId}`).expect(403);
    await as(ctx.app, eve).post('/v1/clubs/join').send({ code: joinCode }).expect(200);
    const ownerLeave = await as(ctx.app, owner).post(`/v1/clubs/${clubId}/leave`).expect(403);
    expect(ownerLeave.body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
  });

  it('replays idempotent requests and rejects key reuse with a different body', async () => {
    const key = `idem-${randomUUID()}`;
    const first = await as(ctx.app, owner)
      .post('/v1/clubs')
      .set('Idempotency-Key', key)
      .send({ name: 'Idempotent Club' })
      .expect(201);
    const second = await as(ctx.app, owner)
      .post('/v1/clubs')
      .set('Idempotency-Key', key)
      .send({ name: 'Idempotent Club' })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    const count = await ctx.db.query(
      `SELECT count(*)::int AS n FROM clubs WHERE name = 'Idempotent Club'`,
    );
    expect(count.rows[0].n).toBe(1);

    const conflict = await as(ctx.app, owner)
      .post('/v1/clubs')
      .set('Idempotency-Key', key)
      .send({ name: 'Different Club' })
      .expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // Keys are scoped per user.
    const other = await as(ctx.app, bob)
      .post('/v1/clubs')
      .set('Idempotency-Key', key)
      .send({ name: 'Idempotent Club' })
      .expect(201);
    expect(other.body.id).not.toBe(first.body.id);
  });
});
