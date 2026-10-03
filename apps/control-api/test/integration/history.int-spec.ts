import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { gameCommand, waitFor } from './support/game';

interface Snapshot {
  hand?: { handId: string; handNo: number; toActSeat: number };
  you?: { seat: number; holeCards: string[] };
}

interface HandDetail {
  id: string;
  status: string;
  myNet: number | null;
  myHoleCards: string[] | null;
  viewerRole: string;
  players: Array<{ userId: string; net: number | null; shownCards: string[] | null }>;
  events: Array<{ seq: number; event: { kind: string } }>;
}

describe('hand history (integration with game-service)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser; // club member who never plays
  let outsider: TestUser;
  let clubId: string;
  let tableId: string;
  /** handId -> each player's hole cards as seen live during the hand. */
  const dealt = new Map<string, Record<string, string[]>>();

  const state = async (u: TestUser) =>
    (await as(ctx.app, u).get(`/v1/tables/${tableId}/state`).expect(200)).body as Snapshot;

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, alice, bob, carol, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
      registerUser(ctx.app, 'carol'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner).post('/v1/clubs').send({ name: 'History Club' });
    clubId = club.body.id;
    for (const u of [alice, bob, carol]) {
      await as(ctx.app, u).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    }
    for (const u of [alice, bob]) {
      await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/chips/grants`)
        .set('Idempotency-Key', `grant-${randomUUID()}`)
        .send({ userId: u.id, amount: 5000 })
        .expect(201);
    }
    const table = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'History Table', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(201);
    tableId = table.body.id;
    for (const [u, seatNo] of [
      [alice, 1],
      [bob, 2],
    ] as const) {
      await as(ctx.app, u)
        .post(`/v1/tables/${tableId}/seat`)
        .send({ seatNo, buyIn: 1000 })
        .expect(200);
    }

    // Three hands in which the first player to act folds preflop: nobody's
    // cards are ever revealed.
    let lastHandNo = 0;
    while (dealt.size < 3) {
      const s = await waitFor('next hand', async () => {
        const v = await state(alice);
        return v.hand && v.hand.handNo > lastHandNo && v.hand.toActSeat ? v : undefined;
      });
      const hand = s.hand!;
      lastHandNo = hand.handNo;
      dealt.set(hand.handId, {
        [alice.id]: s.you!.holeCards,
        [bob.id]: (await state(bob)).you!.holeCards,
      });
      const actor = hand.toActSeat === 1 ? alice : bob;
      expect((await gameCommand(tableId, actor.id, 'FOLD')).status).toBe(200);
    }
    // Wait until the third hand is settled.
    await waitFor('history', async () => {
      const page = await as(ctx.app, alice).get('/v1/me/hands?limit=10').expect(200);
      return page.body.items.length >= 3 ? true : undefined;
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('lists my finished hands newest first with keyset pagination', async () => {
    const first = await as(ctx.app, alice).get('/v1/me/hands?limit=2').expect(200);
    expectSchema('HandSummaryPage', first.body);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await as(ctx.app, alice)
      .get(`/v1/me/hands?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    const ids = [...first.body.items, ...second.body.items].map((h: { id: string }) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of dealt.keys()) expect(ids).toContain(id);
    for (const h of [...first.body.items, ...second.body.items]) {
      expect(h.status).toBe('COMPLETED'); // the hand in progress is never listed
      expect(h).toMatchObject({
        tableId,
        clubId,
        tableName: 'History Table',
        clubName: 'History Club',
      });
      expect(Math.abs(h.myNet)).toBeGreaterThan(0); // a blind is always won or lost here
    }
    expect([...ids].sort().reverse()).toEqual(ids);

    const carolHands = await as(ctx.app, carol).get('/v1/me/hands').expect(200);
    expect(carolHands.body).toEqual({ items: [], nextCursor: null });
    const bad = await as(ctx.app, alice).get('/v1/me/hands?cursor=nope').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('shows participants their own hole cards and never anyone else’s', async () => {
    for (const [handId, cards] of dealt) {
      for (const [me, other] of [
        [alice, bob],
        [bob, alice],
      ] as const) {
        const res = await as(ctx.app, me).get(`/v1/hands/${handId}`).expect(200);
        expectSchema('HandDetail', res.body);
        const hand = res.body as HandDetail;
        expect(hand.viewerRole).toBe('PARTICIPANT');
        expect(hand.myHoleCards).toEqual(cards[me.id]);
        const body = JSON.stringify(hand);
        for (const card of cards[other.id]!) expect(body).not.toContain(`"${card}"`);
        expect(hand.players.every((p) => p.shownCards === null)).toBe(true);
        const kinds = hand.events.map((e) => e.event.kind);
        expect(kinds[0]).toBe('HAND_STARTED');
        expect(kinds).toContain('PLAYER_ACTED');
        expect(kinds.at(-1)).toBe('HAND_COMPLETED');
        expect(hand.players.reduce((sum, p) => sum + (p.net ?? 0), 0)).toBe(0);
      }
    }
  });

  it('gives club staff the public record only and hides hands from everyone else', async () => {
    const [handId, cards] = [...dealt][0]!;
    const staff = await as(ctx.app, owner).get(`/v1/hands/${handId}`).expect(200);
    expectSchema('HandDetail', staff.body);
    expect(staff.body.viewerRole).toBe('CLUB_STAFF');
    expect(staff.body.myHoleCards).toBeNull();
    expect(staff.body.myNet).toBeNull();
    const body = JSON.stringify(staff.body);
    for (const card of [...cards[alice.id]!, ...cards[bob.id]!]) {
      expect(body).not.toContain(`"${card}"`);
    }

    for (const u of [carol, outsider]) {
      const res = await as(ctx.app, u).get(`/v1/hands/${handId}`).expect(404);
      expect(res.body.error.code).toBe('HAND_NOT_FOUND');
    }
    await as(ctx.app, alice).get(`/v1/hands/${randomUUID()}`).expect(404);
  });

  it('lists club hands for staff, filtered by table', async () => {
    const res = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/hands?tableId=${tableId}&limit=50`)
      .expect(200);
    expectSchema('HandSummaryPage', res.body);
    const ids = res.body.items.map((h: { id: string }) => h.id);
    for (const id of dealt.keys()) expect(ids).toContain(id);
    expect(res.body.items.every((h: { myNet: number | null }) => h.myNet === null)).toBe(true);

    const other = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/hands?tableId=${randomUUID()}`)
      .expect(200);
    expect(other.body.items).toEqual([]);
    const member = await as(ctx.app, alice).get(`/v1/clubs/${clubId}/hands`).expect(403);
    expect(member.body.error.code).toBe('FORBIDDEN');
    await as(ctx.app, outsider).get(`/v1/clubs/${clubId}/hands`).expect(403);
  });
});
