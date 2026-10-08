import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { gameCommand, waitFor } from './support/game';

interface Snapshot {
  seq: number;
  phase: string;
  table: { gameType: string };
  seats: Array<{ seat: number; userId: string; stack: number }>;
  hand: null | { handId: string; handNo: number; street: string; toActSeat: number; pot: number };
  you: {
    seat: number;
    muckLosingHands?: boolean;
    holeCards: string[];
    legalActions: Array<{ kind: string; amount?: number; minTo?: number; maxTo?: number }>;
  } | null;
}

describe('tables (integration with game-service)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let clubId: string;
  let tableId: string;

  const wallet = async (u: TestUser) =>
    (await as(ctx.app, u).get(`/v1/clubs/${clubId}/wallet`).expect(200)).body.balance as number;
  const state = async (u: TestUser, id = tableId) => {
    const body = (await as(ctx.app, u).get(`/v1/tables/${id}/state`).expect(200)).body as Snapshot;
    expectSchema('TableSnapshot', body);
    return body;
  };

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, alice, bob, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Table Club' })
      .expect(201);
    clubId = club.body.id;
    for (const u of [alice, bob]) {
      await as(ctx.app, u).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
      await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/chips/grants`)
        .set('Idempotency-Key', `grant-${randomUUID()}`)
        .send({ userId: u.id, amount: 5000 })
        .expect(201);
    }
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('only table managers create tables, with validated stakes', async () => {
    const bad = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Bad', smallBlind: 10, bigBlind: 5, buyInMin: 100, buyInMax: 50 })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const badBank = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({
        name: 'Slow',
        smallBlind: 5,
        bigBlind: 10,
        buyInMin: 200,
        buyInMax: 2000,
        timeBankSec: 301,
      })
      .expect(400);
    expect(badBank.body.error.code).toBe('VALIDATION_FAILED');
    await as(ctx.app, alice)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Mine', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(403);

    const res = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({
        name: 'Main Table',
        maxSeats: 6,
        smallBlind: 5,
        bigBlind: 10,
        buyInMin: 200,
        buyInMax: 2000,
        actionTimeoutSec: 30,
        timeBankSec: 45,
      })
      .expect(201);
    expectSchema('TableDetail', res.body);
    expect(res.body).toMatchObject({
      name: 'Main Table',
      gameType: 'NLHE',
      actionTimeoutSec: 30,
      timeBankSec: 45,
      timeBankRefillSec: 2,
      status: 'OPEN',
      seatedCount: 0,
      seats: [],
    });
    tableId = res.body.id;

    const list = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/tables`).expect(200);
    expectSchema('TableList', list.body);
    expect(list.body.items.map((t: { id: string }) => t.id)).toContain(tableId);
    await as(ctx.app, outsider).get(`/v1/clubs/${clubId}/tables`).expect(403);
    await as(ctx.app, outsider).get(`/v1/tables/${tableId}`).expect(403);
  });

  it('enforces buy-in limits, funds and membership when seating', async () => {
    const low = await as(ctx.app, alice)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 100 })
      .expect(400);
    expect(low.body.error.code).toBe('INVALID_BUY_IN');
    const outsiderSeat = await as(ctx.app, outsider)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 500 })
      .expect(403);
    expect(outsiderSeat.body.error.code).toBe('NOT_CLUB_MEMBER');
    // The owner has no chips: the game service rejects the buy-in.
    const broke = await as(ctx.app, owner)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 500 })
      .expect(422);
    expect(broke.body.error.code).toBe('INSUFFICIENT_CHIPS');
  });

  it('plays a complete hand between two members with consistent accounting', async () => {
    const seatA = await as(ctx.app, alice)
      .post(`/v1/tables/${tableId}/seat`)
      .set('Idempotency-Key', `seat-${randomUUID()}`)
      .send({ seatNo: 1, buyIn: 1000 })
      .expect(200);
    expectSchema('SeatResult', seatA.body);
    expect(seatA.body).toMatchObject({ seatNo: 1, stack: 1000 });
    const taken = await as(ctx.app, bob)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ seatNo: 1, buyIn: 1000 })
      .expect(409);
    expect(taken.body.error.code).toBe('SEAT_TAKEN');
    await as(ctx.app, bob)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ seatNo: 2, buyIn: 1000 })
      .expect(200);
    expect(await wallet(alice)).toBe(4000);
    expect(await wallet(bob)).toBe(4000);

    const detail = await as(ctx.app, alice).get(`/v1/tables/${tableId}`).expect(200);
    expect(detail.body.seats.map((s: { username: string }) => s.username)).toEqual([
      alice.username,
      bob.username,
    ]);

    // A hand starts automatically; each player sees only their own cards.
    const first = await waitFor('hand start', async () => {
      const s = await state(alice);
      return s.hand && s.hand.toActSeat ? s : undefined;
    });
    const bobView = await state(bob);
    expect(first.you!.holeCards).toHaveLength(2);
    expect(bobView.you!.holeCards).toHaveLength(2);
    expect(bobView.you!.holeCards).not.toEqual(first.you!.holeCards);
    expect(JSON.stringify(bobView)).not.toContain(JSON.stringify(first.you!.holeCards));
    const outsiderState = await as(ctx.app, outsider)
      .get(`/v1/tables/${tableId}/state`)
      .expect(403);
    expect(outsiderState.body.error.code).toBe('NOT_CLUB_MEMBER');

    // Play passively (call/check) to showdown through the game service.
    const handNo = first.hand!.handNo;
    const players: Record<number, TestUser> = { 1: alice, 2: bob };
    for (let i = 0; i < 20; i++) {
      const s = await state(alice);
      if (!s.hand || s.hand.handNo !== handNo || !s.hand.toActSeat) break;
      const actor = players[s.hand.toActSeat]!;
      const mine = await state(actor);
      const kinds = mine.you!.legalActions.map((a) => a.kind);
      const kind = kinds.includes('CHECK') ? 'CHECK' : 'CALL';
      const res = await gameCommand(tableId, actor.id, kind);
      expect(res.status).toBe(200);
    }

    // After settlement both stacks still sum to the buy-ins and the ledger agrees.
    const settled = await waitFor('settlement', async () => {
      const r = await ctx.db.query(
        `SELECT status FROM hands WHERE table_id = $1 AND hand_no = $2`,
        [tableId, handNo],
      );
      return r.rows[0]?.status === 'COMPLETED' ? true : undefined;
    });
    expect(settled).toBe(true);
    const seats = (await as(ctx.app, alice).get(`/v1/tables/${tableId}`).expect(200)).body
      .seats as Array<{ stack: number }>;
    expect(seats.reduce((s, x) => s + x.stack, 0)).toBe(2000);
    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);
    const summary = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/ledger/summary`).expect(200);
    expect(summary.body).toMatchObject({ issued: 10000, atTables: 2000, inWallets: 8000 });
  });

  it('runs Pot-Limit Omaha tables: four private cards, pot-limit sizing, history', async () => {
    const stud = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({
        name: 'Stud',
        gameType: 'STUD',
        smallBlind: 5,
        bigBlind: 10,
        buyInMin: 200,
        buyInMax: 2000,
      })
      .expect(400);
    expect(stud.body.error.code).toBe('VALIDATION_FAILED');
    const created = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({
        name: 'Omaha',
        gameType: 'PLO',
        smallBlind: 5,
        bigBlind: 10,
        buyInMin: 200,
        buyInMax: 2000,
      })
      .expect(201);
    expectSchema('TableDetail', created.body);
    expect(created.body.gameType).toBe('PLO');
    const plo = created.body.id as string;

    for (const [u, seatNo] of [
      [alice, 1],
      [bob, 2],
    ] as const) {
      await as(ctx.app, u)
        .post(`/v1/tables/${plo}/seat`)
        .set('Idempotency-Key', `seat-${randomUUID()}`)
        .send({ seatNo, buyIn: 500 })
        .expect(200);
    }
    const first = await waitFor('PLO hand start', async () => {
      const s = await state(alice, plo);
      return s.hand && s.hand.toActSeat ? s : undefined;
    });
    expect(first.table.gameType).toBe('PLO');
    expect(first.you!.holeCards).toHaveLength(4);
    const bobView = await state(bob, plo);
    expect(bobView.you!.holeCards).toHaveLength(4);
    for (const c of first.you!.holeCards) expect(bobView.you!.holeCards).not.toContain(c);

    // Heads-up 5/10: the small blind may raise to at most the pot (30).
    const players: Record<number, TestUser> = { 1: alice, 2: bob };
    const opener = await state(players[first.hand!.toActSeat]!, plo);
    const raise = opener.you!.legalActions.find((a) => a.kind === 'RAISE');
    expect(raise).toMatchObject({ minTo: 20, maxTo: 30 });
    expect(opener.you!.legalActions.map((a) => a.kind)).not.toContain('ALL_IN');
    const over = await gameCommand(plo, players[first.hand!.toActSeat]!.id, 'RAISE', 31);
    expect(over.status).toBe(400);
    expect(over.body).toMatchObject({ error: { code: 'INVALID_RAISE' } });

    const { handId, handNo } = first.hand!;
    for (let i = 0; i < 20; i++) {
      const s = await state(alice, plo);
      if (!s.hand || s.hand.handNo !== handNo || !s.hand.toActSeat) break;
      const actor = players[s.hand.toActSeat]!;
      const kinds = (await state(actor, plo)).you!.legalActions.map((a) => a.kind);
      expect(
        (await gameCommand(plo, actor.id, kinds.includes('CHECK') ? 'CHECK' : 'CALL')).status,
      ).toBe(200);
    }
    await waitFor('PLO settlement', async () => {
      const r = await ctx.db.query(`SELECT status, game_type FROM hands WHERE id = $1`, [handId]);
      return r.rows[0]?.status === 'COMPLETED' ? r.rows[0] : undefined;
    });
    const hand = await as(ctx.app, alice).get(`/v1/hands/${handId}`).expect(200);
    expectSchema('HandDetail', hand.body);
    expect(hand.body.gameType).toBe('PLO');
    expect(hand.body.myHoleCards).toEqual(first.you!.holeCards);
    const mine = await as(ctx.app, alice).get('/v1/me/hands').expect(200);
    expect(mine.body.items.find((h: { id: string }) => h.id === handId)?.gameType).toBe('PLO');

    // Both leave so later tests see only the main table's stacks.
    for (const u of [alice, bob]) {
      await as(ctx.app, u).post(`/v1/tables/${plo}/leave`).expect(200);
    }
    await waitFor('PLO table empty', async () => {
      const r = await ctx.db.query(
        `SELECT count(*)::int AS n FROM table_seats WHERE table_id = $1`,
        [plo],
      );
      return r.rows[0].n === 0 ? true : undefined;
    });
    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);
  });

  it('stores whether a seat mucks losing hands at showdown', async () => {
    const created = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Showdowns', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(201);
    const t = created.body.id as string;
    const notSeated = await as(ctx.app, alice)
      .put(`/v1/tables/${t}/muck-preference`)
      .send({ muckLosingHands: false })
      .expect(409);
    expect(notSeated.body.error.code).toBe('PLAYER_NOT_SEATED');
    await as(ctx.app, alice)
      .post(`/v1/tables/${t}/seat`)
      .send({ seatNo: 1, buyIn: 500 })
      .expect(200);
    expect((await state(alice, t)).you).toMatchObject({ muckLosingHands: true });

    const res = await as(ctx.app, alice)
      .put(`/v1/tables/${t}/muck-preference`)
      .send({ muckLosingHands: false })
      .expect(200);
    expectSchema('MuckPreferenceResult', res.body);
    expect(res.body).toEqual({ tableId: t, muckLosingHands: false });
    expect((await state(alice, t)).you).toMatchObject({ muckLosingHands: false });
    const bad = await as(ctx.app, alice)
      .put(`/v1/tables/${t}/muck-preference`)
      .send({ muckLosingHands: 'no' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await as(ctx.app, outsider)
      .put(`/v1/tables/${t}/muck-preference`)
      .send({ muckLosingHands: true })
      .expect(403);
    await as(ctx.app, alice).post(`/v1/tables/${t}/leave`).expect(200);
  });

  it('tops up and re-buys from the club wallet, also automatically', async () => {
    const created = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Top-ups', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(201);
    const t = created.body.id as string;
    const before = await wallet(alice);
    await as(ctx.app, alice)
      .post(`/v1/tables/${t}/seat`)
      .send({ seatNo: 1, buyIn: 500 })
      .expect(200);

    // Alone at the table (no hand): applied at once, within the limits.
    const res = await as(ctx.app, alice)
      .post(`/v1/tables/${t}/top-up`)
      .set('Idempotency-Key', `top-${randomUUID()}`)
      .send({ amount: 300 })
      .expect(200);
    expectSchema('TopUpResult', res.body);
    expect(res.body).toEqual({ tableId: t, status: 'APPLIED', stack: 800, pending: 0 });
    for (const [body, code] of [
      [{ amount: 0 }, 'VALIDATION_FAILED'],
      [{ amount: 1300 }, 'INVALID_BUY_IN'],
    ] as const) {
      const bad = await as(ctx.app, alice).post(`/v1/tables/${t}/top-up`).send(body).expect(400);
      expect(bad.body.error.code).toBe(code);
    }
    const notSeated = await as(ctx.app, owner)
      .post(`/v1/tables/${t}/top-up`)
      .send({ amount: 100 })
      .expect(409);
    expect(notSeated.body.error.code).toBe('PLAYER_NOT_SEATED');
    const outside = await as(ctx.app, outsider)
      .post(`/v1/tables/${t}/top-up`)
      .send({ amount: 100 })
      .expect(403);
    expect(outside.body.error.code).toBe('NOT_CLUB_MEMBER');

    // Automatic top-up: tops up to the target now, and after every hand.
    const auto = await as(ctx.app, alice)
      .put(`/v1/tables/${t}/auto-top-up`)
      .send({ to: 1000 })
      .expect(200);
    expectSchema('AutoTopUpResult', auto.body);
    expect(auto.body).toEqual({ tableId: t, autoTopUpTo: 1000 });
    const mine = (await as(ctx.app, alice).get(`/v1/tables/${t}/state`).expect(200)).body;
    expectSchema('TableSnapshot', mine);
    expect(mine.you).toMatchObject({ autoTopUpTo: 1000, pendingTopUp: 0 });
    expect(mine.seats[0].stack).toBe(1000);
    const low = await as(ctx.app, alice)
      .put(`/v1/tables/${t}/auto-top-up`)
      .send({ to: 100 })
      .expect(400);
    expect(low.body.error.code).toBe('INVALID_BUY_IN');
    await as(ctx.app, alice).put(`/v1/tables/${t}/auto-top-up`).send({ to: 0 }).expect(200);
    expect(await wallet(alice)).toBe(before - 1000);

    await as(ctx.app, alice).post(`/v1/tables/${t}/leave`).expect(200);
    expect(await wallet(alice)).toBe(before);
    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);
  });

  it('banned members can still leave and recover their chips', async () => {
    await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}/members/${bob.id}`)
      .send({ status: 'BANNED' })
      .expect(200);
    const seat = await as(ctx.app, bob)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 500 })
      .expect(403);
    expect(seat.body.error.code).toBe('CLUB_BANNED');

    const leave = await as(ctx.app, bob).post(`/v1/tables/${tableId}/leave`).expect(200);
    expectSchema('LeaveResult', leave.body);
    if (leave.body.status === 'LEAVING_AFTER_HAND') {
      // A hand is running: bob is auto-acted (check/fold) and removed when it ends.
      await waitFor('bob removed', async () => {
        const r = await ctx.db.query(
          `SELECT count(*)::int AS n FROM table_seats WHERE table_id = $1 AND user_id = $2`,
          [tableId, bob.id],
        );
        return r.rows[0].n === 0 ? true : undefined;
      });
    }
    const r = await ctx.db.query(
      `SELECT coalesce(sum(balance), 0)::bigint AS b FROM ledger_accounts WHERE owner_id = $1 AND kind = 'TABLE_STACK'`,
      [bob.id],
    );
    expect(Number(r.rows[0].b)).toBe(0);
    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);
  });
});
