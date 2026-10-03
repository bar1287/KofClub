import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { integrationEnv } from './support/env';

interface Snapshot {
  seq: number;
  phase: string;
  seats: Array<{ seat: number; userId: string; stack: number }>;
  hand: null | { handId: string; handNo: number; street: string; toActSeat: number; pot: number };
  you: {
    seat: number;
    holeCards: string[];
    legalActions: Array<{ kind: string; amount?: number; minTo?: number }>;
  } | null;
}

const env = integrationEnv();
const gameUrl = `http://127.0.0.1:${env.gameServicePort}`;

/** Sends a player command the way the realtime gateway does (service token). */
async function gameCommand(tableId: string, userId: string, kind: string, amount = 0) {
  const res = await fetch(`${gameUrl}/internal/v1/tables/${tableId}/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.internalToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userId, commandId: randomUUID(), kind, amount }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
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
  const state = async (u: TestUser) => {
    const body = (await as(ctx.app, u).get(`/v1/tables/${tableId}/state`).expect(200))
      .body as Snapshot;
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
      })
      .expect(201);
    expectSchema('TableDetail', res.body);
    expect(res.body).toMatchObject({
      name: 'Main Table',
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
