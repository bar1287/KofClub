import type { TableEventPayload, TableSnapshot } from '../types';
import { aggressiveCommand, actionOptions, isMyTurn, sizingPresets } from './actions';
import { chipsInPlay, initialTableState, seatList, tableReducer, type TableState } from './state';

const TABLE = '0191a000-0000-7000-8000-000000000001';
const ALICE = '0191a000-0000-7000-8000-00000000000a';
const BOB = '0191a000-0000-7000-8000-00000000000b';
const HAND = '0191a000-0000-7000-8000-0000000000f1';
const T0 = '2026-01-01T00:00:00.000Z';

function snapshot(overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    tableId: TABLE,
    seq: 2,
    serverTime: T0,
    phase: 'WAITING_FOR_PLAYERS',
    table: {
      clubId: '0191a000-0000-7000-8000-0000000000c1',
      name: 'Main',
      gameType: 'NLHE',
      maxSeats: 6,
      smallBlind: 5,
      bigBlind: 10,
      buyInMin: 200,
      buyInMax: 2000,
      actionTimeoutMs: 20000,
      timeBankMs: 30000,
      timeBankRefillMs: 2000,
      status: 'OPEN',
    },
    seats: [seat(1, ALICE, 'alice', 1000), seat(2, BOB, 'bob', 1000)],
    you: { userId: ALICE, seat: 1, holeCards: [], legalActions: [] },
    ...overrides,
  };
}

function seat(n: number, userId: string, username: string, stack: number) {
  return {
    seat: n,
    userId,
    username,
    stack,
    sittingOut: false,
    leaving: false,
    inHand: false,
    folded: false,
    allIn: false,
    streetBet: 0,
    timeBankMs: 30000,
  };
}

/** Applies events with consecutive seqs after the state's seq. */
function play(state: TableState, events: TableEventPayload[], receivedAt = 1_000): TableState {
  let s = state;
  for (const event of events) {
    s = tableReducer(s, {
      type: 'event',
      receivedAt,
      message: { type: 'TABLE_EVENT', tableId: TABLE, seq: s.seq + 1, serverTime: T0, event },
    });
  }
  return s;
}

function seatOf(s: TableState, n: number) {
  const seat = s.seats[n];
  if (!seat) throw new Error(`seat ${n} is empty`);
  return seat;
}

function ready(snap = snapshot()): TableState {
  return tableReducer(initialTableState(TABLE, ALICE), {
    type: 'snapshot',
    snapshot: snap,
    receivedAt: 1_000,
  });
}

const handStarted: TableEventPayload = {
  kind: 'HAND_STARTED',
  handId: HAND,
  gameType: 'NLHE',
  handNo: 1,
  buttonSeat: 1,
  smallBlindSeat: 1,
  bigBlindSeat: 2,
  smallBlind: 5,
  bigBlind: 10,
  deckCommitment: 'ab'.repeat(32),
  players: [
    { seat: 1, userId: ALICE, stack: 1000, timeBankMs: 30000 },
    { seat: 2, userId: BOB, stack: 1000, timeBankMs: 30000 },
  ],
};

const handStart: TableEventPayload[] = [
  handStarted,
  { kind: 'BLIND_POSTED', seat: 1, blind: 'SMALL', amount: 5, allIn: false, stack: 995, pot: 5 },
  { kind: 'BLIND_POSTED', seat: 2, blind: 'BIG', amount: 10, allIn: false, stack: 990, pot: 15 },
  { kind: 'HOLE_CARDS_DEALT', seats: [1, 2], cards: ['As', 'Kd'] },
  {
    kind: 'TURN_STARTED',
    seat: 1,
    street: 'PREFLOP',
    currentBet: 10,
    minRaise: 10,
    pot: 15,
    deadline: '2026-01-01T00:00:20.000Z',
    timeoutMs: 20000,
    timeBankMs: 30000,
    legalActions: [
      { kind: 'FOLD' },
      { kind: 'CALL', amount: 5 },
      { kind: 'RAISE', minTo: 20, maxTo: 1000 },
      { kind: 'ALL_IN', amount: 1000 },
    ],
  },
];

describe('tableReducer', () => {
  it('replaces state with a snapshot', () => {
    const s = ready();
    expect(s.ready).toBe(true);
    expect(s.seq).toBe(2);
    expect(s.mySeat).toBe(1);
    expect(seatList(s).map((x) => x.username)).toEqual(['alice', 'bob']);

    const replaced = tableReducer(s, {
      type: 'snapshot',
      receivedAt: 2_000,
      snapshot: snapshot({ seq: 9, seats: [seat(3, BOB, 'bob', 700)] }),
    });
    expect(Object.keys(replaced.seats)).toEqual(['3']); // never merged
    expect(replaced.seq).toBe(9);
    expect(replaced.log.at(-1)?.text).toMatch(/resynchronized/);
  });

  it('ignores events before the first snapshot, duplicates and replays', () => {
    const empty = initialTableState(TABLE, ALICE);
    const msg = {
      type: 'TABLE_EVENT' as const,
      tableId: TABLE,
      seq: 1,
      serverTime: T0,
      event: handStarted,
    };
    expect(tableReducer(empty, { type: 'event', message: msg, receivedAt: 0 })).toBe(empty);

    const s = ready();
    const dup = { ...msg, seq: 2 };
    expect(tableReducer(s, { type: 'event', message: dup, receivedAt: 0 })).toBe(s);
  });

  it('marks the state stale on a sequence gap instead of applying', () => {
    const s = ready();
    const gap = tableReducer(s, {
      type: 'event',
      receivedAt: 0,
      message: { type: 'TABLE_EVENT', tableId: TABLE, seq: 5, serverTime: T0, event: handStarted },
    });
    expect(gap.stale).toBe(true);
    expect(gap.seq).toBe(2);
    expect(gap.hand).toBeNull();
    expect(isMyTurn(gap)).toBe(false);
  });

  it('plays a complete hand and conserves chips at every step', () => {
    let s = ready();
    const total = chipsInPlay(s);
    for (const ev of handStart) {
      s = play(s, [ev]);
      expect(chipsInPlay(s)).toBe(total);
    }
    expect(s.phase).toBe('HAND_IN_PROGRESS');
    expect(s.holeCards).toEqual(['As', 'Kd']);
    expect(s.hand?.toActSeat).toBe(1);
    expect(s.hand?.turnSeq).toBe(s.seq);
    expect(isMyTurn(s)).toBe(true);
    // Local deadline = receipt time + (deadline - serverTime): immune to clock skew.
    expect(s.hand?.deadlineAt).toBe(1_000 + 20_000);

    const rest: TableEventPayload[] = [
      {
        kind: 'PLAYER_ACTED',
        seat: 1,
        action: 'CALL',
        added: 5,
        streetBet: 10,
        stack: 990,
        allIn: false,
        pot: 20,
        timeout: false,
      },
      {
        kind: 'TURN_STARTED',
        seat: 2,
        street: 'PREFLOP',
        currentBet: 10,
        minRaise: 10,
        pot: 20,
        deadline: '2026-01-01T00:00:20.000Z',
        timeoutMs: 20000,
        timeBankMs: 30000,
      },
      {
        kind: 'PLAYER_ACTED',
        seat: 2,
        action: 'CHECK',
        added: 0,
        streetBet: 10,
        stack: 990,
        allIn: false,
        pot: 20,
        timeout: false,
      },
      {
        kind: 'STREET_DEALT',
        street: 'FLOP',
        cards: ['2c', '7d', 'Th'],
        board: ['2c', '7d', 'Th'],
      },
      {
        kind: 'TURN_STARTED',
        seat: 2,
        street: 'FLOP',
        currentBet: 0,
        minRaise: 10,
        pot: 20,
        deadline: '2026-01-01T00:00:40.000Z',
        timeoutMs: 20000,
        timeBankMs: 30000,
      },
      {
        kind: 'PLAYER_ACTED',
        seat: 2,
        action: 'BET',
        added: 30,
        streetBet: 30,
        stack: 960,
        allIn: false,
        pot: 50,
        timeout: false,
      },
      {
        kind: 'PLAYER_ACTED',
        seat: 1,
        action: 'FOLD',
        added: 0,
        streetBet: 0,
        stack: 990,
        allIn: false,
        pot: 50,
        timeout: true,
      },
      { kind: 'UNCALLED_BET_RETURNED', seat: 2, amount: 30, stack: 990, pot: 20 },
      {
        kind: 'POT_AWARDED',
        potIndex: 0,
        amount: 20,
        eligibleSeats: [2],
        winners: [{ seat: 2, amount: 20 }],
        description: '',
      },
      {
        kind: 'HAND_COMPLETED',
        handId: HAND,
        handNo: 1,
        board: ['2c', '7d', 'Th'],
        showdown: false,
        results: [
          { seat: 1, userId: ALICE, stack: 990, net: -10, won: 0, contributed: 10, folded: true },
          { seat: 2, userId: BOB, stack: 1010, net: 10, won: 20, contributed: 10, folded: false },
        ],
      },
    ];
    for (const ev of rest) {
      s = play(s, [ev]);
      expect(chipsInPlay(s)).toBe(total);
      if (ev.kind === 'TURN_STARTED') expect(s.legalActions).toEqual([]); // bob's turn
    }
    expect(s.phase).toBe('WAITING_FOR_PLAYERS');
    expect(s.hand?.street).toBe('COMPLETE');
    expect(seatOf(s, 1).folded).toBe(true);
    expect(seatOf(s, 1).stack).toBe(990);
    expect(seatOf(s, 2).stack).toBe(1010);
    expect(s.lastHand?.results).toHaveLength(2);
    expect(s.lastHand?.awards[0]?.amount).toBe(20);
    expect(s.log.some((l) => l.text.includes('(timeout)'))).toBe(true);
    expect(isMyTurn(s)).toBe(false);
  });

  it('shows revealed cards and resets them on the next hand', () => {
    let s = play(ready(), handStart);
    s = play(s, [
      {
        kind: 'CARDS_REVEALED',
        seat: 2,
        cards: ['Qh', 'Qs'],
        description: 'Pair of Queens',
        bestFive: ['Qh', 'Qs', 'Th', '7d', '2c'],
      },
    ]);
    expect(seatOf(s, 2).shownCards).toEqual(['Qh', 'Qs']);
    s = play(s, [{ ...handStarted, handNo: 2 } as TableEventPayload]);
    expect(seatOf(s, 2).shownCards).toBeUndefined();
    expect(s.holeCards).toEqual([]);
  });

  it('follows a time bank: start, what is left after acting, and refills', () => {
    let s = play(ready(), handStart);
    expect(s.hand?.usingTimeBank).toBe(false);
    s = play(s, [
      {
        kind: 'TIME_BANK_STARTED',
        seat: 1,
        deadline: '2026-01-01T00:00:30.000Z',
        timeoutMs: 30000,
      },
    ]);
    expect(s.hand).toMatchObject({ usingTimeBank: true, turnTimeoutMs: 30000, toActSeat: 1 });
    expect(s.hand?.deadlineAt).toBe(1_000 + 30_000);
    expect(s.log.at(-1)?.text).toBe('alice is using the time bank (30s).');

    s = play(s, [
      {
        kind: 'PLAYER_ACTED',
        seat: 1,
        action: 'CALL',
        added: 5,
        streetBet: 10,
        stack: 990,
        allIn: false,
        pot: 20,
        timeout: false,
        timeBankMs: 12000,
      },
    ]);
    expect(s.hand?.usingTimeBank).toBe(false);
    expect(seatOf(s, 1).timeBankMs).toBe(12000);
    expect(seatOf(s, 2).timeBankMs).toBe(30000);

    // The next hand reports every dealt-in player's refilled bank.
    s = play(s, [
      {
        ...handStarted,
        handNo: 2,
        players: [
          { seat: 1, userId: ALICE, stack: 990, timeBankMs: 14000 },
          { seat: 2, userId: BOB, stack: 1010, timeBankMs: 30000 },
        ],
      } as TableEventPayload,
    ]);
    expect(seatOf(s, 1).timeBankMs).toBe(14000);
  });

  it("times a running bank from a snapshot by the actor's bank", () => {
    const s = ready(
      snapshot({
        phase: 'HAND_IN_PROGRESS',
        seats: [
          { ...seat(1, ALICE, 'alice', 990), inHand: true, timeBankMs: 25000 },
          { ...seat(2, BOB, 'bob', 990), inHand: true },
        ],
        hand: {
          handId: HAND,
          handNo: 1,
          street: 'FLOP',
          board: ['2c', '7d', 'Th'],
          pot: 20,
          currentBet: 0,
          minRaise: 10,
          buttonSeat: 2,
          smallBlindSeat: 2,
          bigBlindSeat: 1,
          toActSeat: 1,
          usingTimeBank: true,
          actionDeadline: '2026-01-01T00:00:10.000Z',
          turnSeq: 2,
          deckCommitment: 'cd'.repeat(32),
        },
      }),
    );
    expect(s.hand).toMatchObject({ usingTimeBank: true, turnTimeoutMs: 25000 });
  });

  it('restores start-of-hand stacks when a hand is voided', () => {
    let s = play(ready(), handStart);
    expect(seatOf(s, 1).stack).toBe(995);
    s = play(s, [{ kind: 'HAND_VOIDED', handId: HAND, handNo: 1, reason: 'OWNERSHIP_LOST' }]);
    expect(s.hand).toBeNull();
    expect(seatOf(s, 1).stack).toBe(1000);
    expect(seatOf(s, 2).stack).toBe(1000);
    expect(s.stale).toBe(false);
  });

  it('requests a resync when a hand joined via snapshot is voided', () => {
    let s = ready(
      snapshot({
        phase: 'HAND_IN_PROGRESS',
        hand: {
          handId: HAND,
          handNo: 1,
          street: 'FLOP',
          board: ['2c', '7d', 'Th'],
          pot: 20,
          currentBet: 0,
          minRaise: 10,
          buttonSeat: 1,
          smallBlindSeat: 1,
          bigBlindSeat: 2,
          toActSeat: 2,
          usingTimeBank: false,
          actionDeadline: '2026-01-01T00:00:05.000Z',
          turnSeq: 2,
          deckCommitment: 'cd'.repeat(32),
        },
      }),
    );
    expect(s.hand?.deadlineAt).toBe(1_000 + 5_000);
    s = play(s, [{ kind: 'HAND_VOIDED', handId: HAND, handNo: 1, reason: 'X' }]);
    expect(s.stale).toBe(true);
  });

  it('tracks seating, sitting out and leaving', () => {
    let s = ready(
      snapshot({ seats: [], you: { userId: ALICE, seat: 0, holeCards: [], legalActions: [] } }),
    );
    s = play(s, [{ kind: 'PLAYER_SEATED', seat: 4, userId: ALICE, username: 'alice', stack: 500 }]);
    expect(s.mySeat).toBe(4);
    s = play(s, [
      { kind: 'PLAYER_SITTING_OUT', seat: 4, userId: ALICE, sittingOut: true, reason: 'TIMEOUTS' },
    ]);
    expect(seatOf(s, 4).sittingOut).toBe(true);
    s = tableReducer(s, { type: 'leaving', leaving: true });
    expect(seatOf(s, 4).leaving).toBe(true);
    s = play(s, [{ kind: 'PLAYER_LEFT', seat: 4, userId: ALICE, reason: 'LEFT', cashOut: 500 }]);
    expect(s.mySeat).toBe(0);
    expect(s.seats[4]).toBeUndefined();
  });
});

describe('action helpers', () => {
  it('derives options and pot-relative presets from legal actions', () => {
    const s = play(ready(), handStart);
    const opts = actionOptions(s.legalActions);
    expect(opts).toMatchObject({ canFold: true, canCheck: false, callAmount: 5, allInTo: 1000 });
    expect(opts.aggressive).toEqual({ kind: 'RAISE', minTo: 20, maxTo: 1000 });
    // currentBet 10, pot 15, alice has 5 in: pot after call = 20 → pot raise to 30, half → 20.
    expect(sizingPresets(s)).toEqual([
      { label: 'Min', to: 20 },
      { label: 'Pot', to: 30 },
      { label: 'All-in', to: 1000 },
    ]);
  });

  it('caps presets at the pot limit and never sends a capped raise as all-in', () => {
    // PLO heads-up 5/10, small blind to act with 1000: raise 20..30, no all-in.
    const plo = handStart.map((e) =>
      e.kind === 'TURN_STARTED'
        ? {
            ...e,
            legalActions: [
              { kind: 'FOLD' as const },
              { kind: 'CALL' as const, amount: 5 },
              { kind: 'RAISE' as const, minTo: 20, maxTo: 30 },
            ],
          }
        : e,
    );
    const s = play(ready(), plo);
    expect(sizingPresets(s)).toEqual([
      { label: 'Min', to: 20 },
      { label: 'Pot', to: 30 },
    ]);
    const opts = actionOptions(s.legalActions);
    expect(aggressiveCommand(opts, 30)).toEqual({ kind: 'RAISE', amount: 30 });
    expect(aggressiveCommand(opts, 31)).toBeNull();
    // A short stack inside the limit still moves in with ALL_IN.
    const short = actionOptions([
      { kind: 'FOLD' },
      { kind: 'CALL', amount: 20 },
      { kind: 'RAISE', minTo: 40, maxTo: 40 },
      { kind: 'ALL_IN', amount: 40 },
    ]);
    expect(aggressiveCommand(short, 40)).toEqual({ kind: 'ALL_IN' });
  });

  it('builds BET/RAISE/ALL_IN commands and rejects out-of-range sizes', () => {
    const opts = actionOptions([
      { kind: 'FOLD' },
      { kind: 'CHECK' },
      { kind: 'BET', minTo: 10, maxTo: 300 },
      { kind: 'ALL_IN', amount: 300 },
    ]);
    expect(aggressiveCommand(opts, 50)).toEqual({ kind: 'BET', amount: 50 });
    expect(aggressiveCommand(opts, 300)).toEqual({ kind: 'ALL_IN' });
    expect(aggressiveCommand(opts, 5)).toBeNull();
    expect(aggressiveCommand(opts, 12.5)).toBeNull();
    expect(aggressiveCommand(actionOptions([{ kind: 'FOLD' }]), 50)).toBeNull();
  });
});

describe('table closure', () => {
  it('marks the table closed and removes cashed-out players', () => {
    let s = play(ready(), [{ kind: 'TABLE_CLOSED' }]);
    expect(s.table?.status).toBe('CLOSED');
    s = play(s, [
      { kind: 'PLAYER_LEFT', seat: 1, userId: ALICE, reason: 'TABLE_CLOSED', cashOut: 1000 },
      { kind: 'PLAYER_LEFT', seat: 2, userId: BOB, reason: 'TABLE_CLOSED', cashOut: 1000 },
    ]);
    expect(seatList(s)).toEqual([]);
    expect(s.mySeat).toBe(0);
    expect(s.log.at(-1)?.text).toBe('bob is cashed out (1000 back to wallet).');
  });
});

describe('resume', () => {
  it('clears staleness only when SUBSCRIBED matches the applied seq', () => {
    let s = tableReducer(ready(), { type: 'stale' });
    expect(tableReducer(s, { type: 'live', seq: 9 }).stale).toBe(true);
    s = tableReducer(s, { type: 'live', seq: 2 });
    expect(s.stale).toBe(false);
  });
});

describe('tournament tables', () => {
  const info = {
    tournamentId: '0191a000-0000-7000-8000-0000000000aa',
    name: 'Cup',
    tableNo: 2,
    status: 'RUNNING' as const,
    level: 3,
    smallBlind: 20,
    bigBlind: 40,
    nextSmallBlind: 30,
    nextBigBlind: 60,
    levelEndsAt: '2026-01-01T00:05:00.000Z',
  };

  it('takes the level and blinds of each hand', () => {
    const s = play(ready(), [
      { ...handStarted, smallBlind: 20, bigBlind: 40, tournament: info } as TableEventPayload,
    ]);
    expect(s.table?.tournament?.level).toBe(3);
    expect(s.table).toMatchObject({ smallBlind: 20, bigBlind: 40 });
  });

  it('records why the viewer left (moved, eliminated)', () => {
    let s = play(ready(), [
      {
        kind: 'PLAYER_LEFT',
        seat: 2,
        userId: BOB,
        reason: 'ELIMINATED',
        cashOut: 0,
        place: 5,
      },
    ]);
    expect(s.departure).toBeNull();
    s = play(s, [
      {
        kind: 'PLAYER_LEFT',
        seat: 1,
        userId: ALICE,
        reason: 'MOVED',
        cashOut: 0,
        toTableId: info.tournamentId,
      },
    ]);
    expect(s.departure).toEqual({
      reason: 'MOVED',
      toTableId: info.tournamentId,
      place: undefined,
    });
    expect(s.mySeat).toBe(0);
    expect(s.log.at(-1)?.text).toBe('alice moves to another table.');
  });

  it('follows a redirect for a viewer who was waiting to be seated (seat 0)', () => {
    const waiting = ready(snapshot({ seats: [seat(2, BOB, 'bob', 1000)], you: undefined }));
    expect(waiting.mySeat).toBe(0);
    const s = play(waiting, [
      {
        kind: 'PLAYER_LEFT',
        seat: 0,
        userId: ALICE,
        reason: 'MOVED',
        cashOut: 0,
        toTableId: TABLE,
      },
    ]);
    expect(s.departure).toEqual({ reason: 'MOVED', toTableId: TABLE, place: undefined });
    expect(Object.keys(s.seats)).toEqual(['2']);
    expect(s.log).toEqual(waiting.log);
  });
});
