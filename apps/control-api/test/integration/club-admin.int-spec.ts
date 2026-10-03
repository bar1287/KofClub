import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { gameCommand, waitFor } from './support/game';

describe('club administration (integration)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let clubId: string;

  const wallet = async (u: TestUser) =>
    (await as(ctx.app, u).get(`/v1/clubs/${clubId}/wallet`).expect(200)).body.balance as number;

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, admin, alice, bob] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'admin'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
    ]);
    const club = await as(ctx.app, owner).post('/v1/clubs').send({ name: 'Admin Club' });
    clubId = club.body.id;
    for (const u of [admin, alice, bob]) {
      await as(ctx.app, u).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    }
    await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}/members/${admin.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
    for (const u of [alice, bob]) {
      await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/chips/grants`)
        .set('Idempotency-Key', `grant-${randomUUID()}`)
        .send({ userId: u.id, amount: 3000 })
        .expect(201);
    }
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('lets only the owner edit club settings', async () => {
    const res = await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}`)
      .send({ name: 'Renamed Club', description: 'Friday night game' })
      .expect(200);
    expectSchema('Club', res.body);
    expect(res.body).toMatchObject({ name: 'Renamed Club', description: 'Friday night game' });
    const cleared = await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}`)
      .send({ description: null })
      .expect(200);
    expect(cleared.body.description).toBeNull();
    await as(ctx.app, admin).patch(`/v1/clubs/${clubId}`).send({ name: 'Mine now' }).expect(403);
    const empty = await as(ctx.app, owner).patch(`/v1/clubs/${clubId}`).send({}).expect(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('closes a table mid-hand and cashes everyone out after the hand', async () => {
    const table = await as(ctx.app, admin)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Closing Table', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(201);
    const tableId = table.body.id as string;
    for (const [u, seatNo] of [
      [alice, 1],
      [bob, 2],
    ] as const) {
      await as(ctx.app, u)
        .post(`/v1/tables/${tableId}/seat`)
        .send({ seatNo, buyIn: 1000 })
        .expect(200);
    }
    const state = async () =>
      (await as(ctx.app, alice).get(`/v1/tables/${tableId}/state`).expect(200)).body as {
        table: { status: string };
        seats: unknown[];
        hand?: { handNo: number; toActSeat: number };
      };
    const live = await waitFor('hand', async () => {
      const s = await state();
      return s.hand && s.hand.toActSeat ? s : undefined;
    });

    await as(ctx.app, alice).post(`/v1/tables/${tableId}/close`).expect(403);
    const closing = await as(ctx.app, admin).post(`/v1/tables/${tableId}/close`).expect(200);
    expectSchema('CloseTableResult', closing.body);
    expect(closing.body).toEqual({ tableId, status: 'CLOSING', seated: 2 });

    // Finish the hand: the player to act folds.
    const actor = live.hand!.toActSeat === 1 ? alice : bob;
    expect((await gameCommand(tableId, actor.id, 'FOLD')).status).toBe(200);
    await waitFor('cash-out', async () => ((await state()).seats.length === 0 ? true : undefined));
    expect((await state()).table.status).toBe('CLOSED');
    expect((await wallet(alice)) + (await wallet(bob))).toBe(6000);

    const again = await as(ctx.app, admin).post(`/v1/tables/${tableId}/close`).expect(200);
    expect(again.body).toEqual({ tableId, status: 'CLOSED', seated: 0 });
    const seat = await as(ctx.app, alice)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 500 })
      .expect(409);
    expect(seat.body.error.code).toBe('TABLE_CLOSED');
    const list = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/tables`).expect(200);
    expect(list.body.items.find((t: { id: string }) => t.id === tableId).status).toBe('CLOSED');

    const audit = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/audit-log`).expect(200);
    const closes = audit.body.items.filter((a: { action: string }) => a.action === 'TABLE_CLOSED');
    expect(closes).toHaveLength(1);
  });

  it('transfers ownership to an active member and demotes the old owner to admin', async () => {
    await as(ctx.app, admin)
      .post(`/v1/clubs/${clubId}/transfer-ownership`)
      .send({ userId: alice.id })
      .expect(403);
    const self = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/transfer-ownership`)
      .send({ userId: owner.id })
      .expect(400);
    expect(self.body.error.code).toBe('VALIDATION_FAILED');
    await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/transfer-ownership`)
      .send({ userId: randomUUID() })
      .expect(404);

    const res = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/transfer-ownership`)
      .send({ userId: alice.id })
      .expect(200);
    expectSchema('Club', res.body);
    expect(res.body).toMatchObject({ ownerUserId: alice.id, myRole: 'ADMIN' });

    const aliceView = await as(ctx.app, alice).get(`/v1/clubs/${clubId}`).expect(200);
    expect(aliceView.body.myRole).toBe('OWNER');
    const members = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/members`).expect(200);
    const roles = Object.fromEntries(
      members.body.items.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(roles[alice.id]).toBe('OWNER');
    expect(roles[owner.id]).toBe('ADMIN');
    expect(Object.values(roles).filter((r) => r === 'OWNER')).toHaveLength(1);

    // The former owner lost owner-only powers; the new owner has them.
    await as(ctx.app, owner).patch(`/v1/clubs/${clubId}`).send({ name: 'Nope Club' }).expect(403);
    await as(ctx.app, alice).patch(`/v1/clubs/${clubId}`).send({ name: 'Alice Club' }).expect(200);
  });
});
