import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { gameCommand, waitFor } from './support/game';

interface Detail {
  id: string;
  status: string;
  registered: boolean;
  registeredCount: number;
  prizePool: number;
  myTableId: string | null;
  payouts: Array<{ place: number; amount: number }>;
  entrants: Array<{ userId: string; place: number | null; prize: number; tableId: string | null }>;
  currentLevel: { level: number; bigBlind: number } | null;
}

interface Snapshot {
  table: { tournament?: { tournamentId: string; level: number } };
  hand: null | { handNo: number; toActSeat: number };
  you: { seat: number; legalActions: Array<{ kind: string }> } | null;
}

describe('tournaments (integration with game-service)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let clubId: string;

  const wallet = async (u: TestUser) =>
    (await as(ctx.app, u).get(`/v1/clubs/${clubId}/wallet`).expect(200)).body.balance as number;
  const detail = async (u: TestUser, id: string) => {
    const body = (await as(ctx.app, u).get(`/v1/tournaments/${id}`).expect(200)).body as Detail;
    expectSchema('TournamentDetail', body);
    return body;
  };
  const create = (u: TestUser, body: Record<string, unknown>) =>
    as(ctx.app, u).post(`/v1/clubs/${clubId}/tournaments`).send(body);
  const sng = {
    name: 'Friday Cup',
    buyIn: 100,
    startingStack: 1000,
    smallBlind: 10,
    bigBlind: 20,
    levelDurationSec: 60,
    seatsPerTable: 2,
    minPlayers: 2,
    maxPlayers: 3,
    startMode: 'SIT_AND_GO',
  };

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, alice, bob, carol, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
      registerUser(ctx.app, 'carol'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner).post('/v1/clubs').send({ name: 'Cup Club' }).expect(201);
    clubId = club.body.id;
    for (const u of [alice, bob, carol]) {
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

  it('validates tournaments and lets only table managers create them', async () => {
    const thin = await create(owner, { ...sng, startingStack: 150 }).expect(400);
    expect(thin.body.error.code).toBe('VALIDATION_FAILED');
    await create(owner, { ...sng, startMode: 'SCHEDULED' }).expect(400);
    await create(owner, { ...sng, startsAt: new Date(Date.now() + 60_000).toISOString() }).expect(
      400,
    );
    await create(owner, { ...sng, minPlayers: 5 }).expect(400);
    await create(alice, sng).expect(403);
  });

  it('runs a sit-and-go: registration with buy-ins, start, play to the end, payouts', async () => {
    const res = await create(owner, sng).expect(201);
    expectSchema('TournamentDetail', res.body);
    const id = res.body.id as string;
    expect(res.body).toMatchObject({ status: 'REGISTERING', registeredCount: 0, prizePool: 0 });
    expect(res.body.levels).toHaveLength(20);
    expect(res.body.levels[1]).toEqual({ level: 2, smallBlind: 15, bigBlind: 30 });

    // Its two tables exist but stay out of the cash lobby.
    const tables = await ctx.db.query(
      `SELECT id FROM tables WHERE tournament_id = $1 ORDER BY tournament_table_no`,
      [id],
    );
    expect(tables.rows).toHaveLength(2);
    const lobby = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/tables`).expect(200);
    expect(lobby.body.items.map((t: { id: string }) => t.id)).not.toContain(tables.rows[0].id);
    const list = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/tournaments`).expect(200);
    expectSchema('TournamentList', list.body);
    expect(list.body.items.map((t: { id: string }) => t.id)).toContain(id);

    // Registration moves the buy-in into the prize pool; unregistering refunds it.
    let d = (await as(ctx.app, alice).post(`/v1/tournaments/${id}/register`).expect(200))
      .body as Detail;
    expect(d).toMatchObject({ registered: true, registeredCount: 1, prizePool: 100 });
    expect(await wallet(alice)).toBe(4900);
    const again = await as(ctx.app, alice).post(`/v1/tournaments/${id}/register`).expect(409);
    expect(again.body.error.code).toBe('ALREADY_REGISTERED');
    const summary = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/ledger/summary`).expect(200);
    expectSchema('LedgerSummary', summary.body);
    expect(summary.body).toMatchObject({ issued: 15000, inWallets: 14900, inTournaments: 100 });
    await as(ctx.app, alice).post(`/v1/tournaments/${id}/unregister`).expect(200);
    expect(await wallet(alice)).toBe(5000);
    const notReg = await as(ctx.app, alice).post(`/v1/tournaments/${id}/unregister`).expect(409);
    expect(notReg.body.error.code).toBe('NOT_REGISTERED');
    await as(ctx.app, alice).post(`/v1/tournaments/${id}/register`).expect(200);
    const outsiderReg = await as(ctx.app, outsider)
      .post(`/v1/tournaments/${id}/register`)
      .expect(403);
    expect(outsiderReg.body.error.code).toBe('NOT_CLUB_MEMBER');

    // Starting early needs staff and at least minPlayers.
    await as(ctx.app, alice).post(`/v1/tournaments/${id}/start`).expect(403);
    const few = await as(ctx.app, owner).post(`/v1/tournaments/${id}/start`).expect(409);
    expect(few.body.error.code).toBe('NOT_ENOUGH_PLAYERS');
    d = (await as(ctx.app, bob).post(`/v1/tournaments/${id}/register`).expect(200)).body as Detail;
    expect(d.payouts).toEqual([{ place: 1, amount: 200 }]);
    await as(ctx.app, owner).post(`/v1/tournaments/${id}/start`).expect(202);

    // The game service seats both players at one table within a moment.
    const running = await waitFor('tournament start', async () => {
      const t = await detail(alice, id);
      return t.status === 'RUNNING' && t.myTableId ? t : undefined;
    });
    expect(running.currentLevel).toMatchObject({ level: 1, bigBlind: 20 });
    const late = await as(ctx.app, carol).post(`/v1/tournaments/${id}/register`).expect(409);
    expect(late.body.error.code).toBe('TOURNAMENT_NOT_OPEN');
    const tableId = running.myTableId!;
    const seat = await as(ctx.app, carol)
      .post(`/v1/tables/${tableId}/seat`)
      .send({ buyIn: 500 })
      .expect(403);
    expect(seat.body.error.code).toBe('FORBIDDEN');
    await as(ctx.app, alice).post(`/v1/tables/${tableId}/leave`).expect(403);

    const state = async (u: TestUser) => {
      const body = (await as(ctx.app, u).get(`/v1/tables/${tableId}/state`).expect(200))
        .body as Snapshot;
      expectSchema('TableSnapshot', body);
      return body;
    };
    expect((await state(alice)).table.tournament).toMatchObject({ tournamentId: id, level: 1 });

    // Both players move all-in every hand until one has all the chips.
    const players = [alice, bob];
    const finished = await waitFor(
      'tournament end',
      async () => {
        const t = await detail(alice, id);
        if (t.status === 'FINISHED') return t;
        for (const p of players) {
          const s = await state(p);
          if (!s.hand || !s.you || s.hand.toActSeat !== s.you.seat) continue;
          const kinds = s.you.legalActions.map((a) => a.kind);
          const kind = kinds.includes('ALL_IN')
            ? 'ALL_IN'
            : kinds.includes('CALL')
              ? 'CALL'
              : 'CHECK';
          await gameCommand(tableId, p.id, kind);
        }
        return undefined;
      },
      60_000,
    );
    expect(finished.payouts).toEqual([{ place: 1, amount: 200 }]);
    const places = finished.entrants.map((e) => e.place).sort();
    expect(places).toEqual([1, 2]);
    const winner = finished.entrants.find((e) => e.place === 1)!;
    expect(winner.prize).toBe(200);
    const winnerUser = winner.userId === alice.id ? alice : bob;
    const loserUser = winner.userId === alice.id ? bob : alice;
    expect(await wallet(winnerUser)).toBe(5100);
    expect(await wallet(loserUser)).toBe(4900);
    const after = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/ledger/summary`).expect(200);
    expect(after.body).toMatchObject({ issued: 15000, inWallets: 15000, inTournaments: 0 });
    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);

    // Tournament hands appear in history with their tournament.
    const mine = await as(ctx.app, alice).get('/v1/me/hands').expect(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items[0].tournamentId).toBe(id);
  });

  it('cancels a scheduled tournament and refunds every buy-in', async () => {
    const res = await create(owner, {
      ...sng,
      name: 'Sunday Major',
      startMode: 'SCHEDULED',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }).expect(201);
    const id = res.body.id as string;
    const before = await wallet(carol);
    await as(ctx.app, carol).post(`/v1/tournaments/${id}/register`).expect(200);
    expect(await wallet(carol)).toBe(before - 100);
    await as(ctx.app, carol).post(`/v1/tournaments/${id}/cancel`).expect(403);
    const cancelled = await as(ctx.app, owner).post(`/v1/tournaments/${id}/cancel`).expect(200);
    expectSchema('TournamentDetail', cancelled.body);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await wallet(carol)).toBe(before);
    const closed = await as(ctx.app, carol).post(`/v1/tournaments/${id}/register`).expect(409);
    expect(closed.body.error.code).toBe('TOURNAMENT_NOT_OPEN');
    await as(ctx.app, owner).post(`/v1/tournaments/${id}/cancel`).expect(409);
    const audit = await ctx.db.query(
      `SELECT action FROM audit_log WHERE object_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'TOURNAMENT_CREATED',
      'TOURNAMENT_CANCELLED',
    ]);
  });
});
