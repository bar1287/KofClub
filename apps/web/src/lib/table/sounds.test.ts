import { RECIPES } from '../sound';
import { soundsFor } from './sounds';
import { initialTableState, type HandState, type SeatState, type TableState } from './state';

function seat(n: number, patch: Partial<SeatState> = {}): SeatState {
  return {
    seat: n,
    userId: `u${n}`,
    username: `p${n}`,
    stack: 1000,
    sittingOut: false,
    leaving: false,
    inHand: true,
    folded: false,
    allIn: false,
    streetBet: 0,
    timeBankMs: 0,
    ...patch,
  };
}

function hand(patch: Partial<HandState> = {}): HandState {
  return {
    handId: 'h1',
    handNo: 1,
    street: 'PREFLOP',
    board: [],
    pot: 15,
    currentBet: 10,
    minRaise: 10,
    bigBlind: 10,
    buttonSeat: 1,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    toActSeat: 2,
    deadlineAt: null,
    turnTimeoutMs: 20000,
    usingTimeBank: false,
    turnSeq: 5,
    deckCommitment: '',
    awards: [],
    startStacks: null,
    ...patch,
  };
}

function table(seq: number, patch: Partial<TableState> = {}): TableState {
  return {
    ...initialTableState('t1', 'u1'),
    ready: true,
    seq,
    mySeat: 1,
    seats: { 1: seat(1), 2: seat(2) },
    hand: hand(),
    ...patch,
  };
}

describe('soundsFor', () => {
  it('stays quiet for snapshots and repeated states', () => {
    const s = table(5);
    expect(soundsFor({ ...s, ready: false }, s)).toEqual([]);
    expect(soundsFor(s, s)).toEqual([]);
  });

  it('deals, puts chips in and knocks', () => {
    const before = table(5, { hand: null });
    expect(soundsFor(before, table(6))).toEqual(['deal']);
    const flop = table(7, { hand: hand({ street: 'FLOP', board: ['2c', '3d', '4h'] }) });
    expect(soundsFor(table(6), flop)).toContain('deal');
    const bet = table(8, {
      hand: hand({ pot: 55 }),
      seats: { 1: seat(1), 2: seat(2, { lastAction: 'RAISE' }) },
    });
    expect(soundsFor(table(7), bet)).toEqual(['chips']);
    const check = table(8, { seats: { 1: seat(1), 2: seat(2, { lastAction: 'CHECK' }) } });
    expect(soundsFor(table(7), check)).toEqual(['check']);
    const fold = table(8, { seats: { 1: seat(1), 2: seat(2, { lastAction: 'FOLD' }) } });
    expect(soundsFor(table(7), fold)).toEqual(['fold']);
  });

  it('chimes once when the turn comes to the viewer, and celebrates wins', () => {
    const mine = table(9, { hand: hand({ toActSeat: 1, turnSeq: 9 }) });
    expect(soundsFor(table(8), mine)).toEqual(['turn']);
    expect(soundsFor(mine, { ...mine, seq: 10 })).toEqual([]);
    const won = table(12, {
      lastHand: {
        handId: 'h1',
        handNo: 1,
        showdown: false,
        awards: [],
        results: [
          { seat: 1, userId: 'u1', stack: 1010, net: 10, won: 20, contributed: 10, folded: false },
          { seat: 2, userId: 'u2', stack: 990, net: -10, won: 0, contributed: 10, folded: true },
        ],
      },
      hand: hand({ street: 'COMPLETE', toActSeat: 0 }),
    });
    expect(soundsFor(table(11, { hand: hand({ street: 'COMPLETE', toActSeat: 0 }) }), won)).toEqual(
      ['win'],
    );
  });

  it('has a recipe for every sound', () => {
    for (const tones of Object.values(RECIPES)) expect(tones.length).toBeGreaterThan(0);
  });
});
