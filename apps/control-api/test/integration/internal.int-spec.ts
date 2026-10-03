import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';

describe('internal service API (integration)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let tableId: string;

  const access = (userId: string, table = tableId, token = ctx.config.INTERNAL_SERVICE_TOKEN) =>
    request(ctx.app.getHttpServer())
      .get(`/internal/v1/tables/${table}/access?userId=${userId}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, member, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'member'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Internal Club' })
      .expect(201);
    await as(ctx.app, member).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    const table = await as(ctx.app, owner)
      .post(`/v1/clubs/${club.body.id}/tables`)
      .send({ name: 'Access Table', smallBlind: 1, bigBlind: 2, buyInMin: 40, buyInMax: 400 })
      .expect(201);
    tableId = table.body.id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('requires the service token and is not under the public /v1 prefix', async () => {
    expect((await access(member.id, tableId, 'wrong-token').expect(401)).body.error.code).toBe(
      'AUTH_REQUIRED',
    );
    await request(ctx.app.getHttpServer())
      .get(`/internal/v1/tables/${tableId}/access?userId=${member.id}`)
      .expect(401);
    // A user's access token is not a service token.
    await request(ctx.app.getHttpServer())
      .get(`/internal/v1/tables/${tableId}/access?userId=${member.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(401);
    await as(ctx.app, member)
      .get(`/v1/internal/v1/tables/${tableId}/access?userId=${member.id}`)
      .expect(404);
  });

  it('decides table access with club membership rules', async () => {
    expect((await access(member.id).expect(200)).body).toMatchObject({ allowed: true });
    expect((await access(owner.id).expect(200)).body).toMatchObject({ allowed: true });
    expect((await access(outsider.id).expect(200)).body).toMatchObject({
      allowed: false,
      code: 'NOT_CLUB_MEMBER',
    });
    expect((await access(member.id, randomUUID()).expect(200)).body).toMatchObject({
      allowed: false,
      code: 'TABLE_NOT_FOUND',
    });

    const clubId = (await access(member.id).expect(200)).body.clubId;
    await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}/members/${member.id}`)
      .send({ status: 'BANNED' })
      .expect(200);
    expect((await access(member.id).expect(200)).body).toMatchObject({
      allowed: false,
      code: 'CLUB_BANNED',
    });

    await ctx.db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [outsider.id]);
    expect((await access(outsider.id).expect(200)).body).toMatchObject({
      allowed: false,
      code: 'ACCOUNT_SUSPENDED',
    });
    await access('not-a-uuid').expect(400);
  });
});
