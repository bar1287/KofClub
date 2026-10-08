import type { LegalAction } from '../types';
import {
  availablePreActions,
  preActionContext,
  preActionStillValid,
  resolvePreAction,
  type PreAction,
} from './preactions';
import { initialTableState, type HandState, type SeatState, type TableState } from './state';

const ME = 'me-0000';

function seat(n: number, userId: string, patch: Partial<SeatState> = {}): SeatState {
  return {
    seat: n,
    userId,
    username: userId,
    stack: 1_000,
    sittingOut: false,
    leaving: false,
    inHand: true,
    folded: false,
    allIn: false,
    streetBet: 0,
    timeBankMs: 30_000,
    ...patch,
  };
}

function hand(patch: Partial<HandState> = {}): HandState {
  return {
    handId: 'h1',
    handNo: 7,
    street: 'FLOP',
    board: [],
    pot: 100,
    currentBet: 0,
    minRaise: 10,
    bigBlind: 10,
    buttonSeat: 1,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    toActSeat: 2,
    deadlineAt: null,
    turnTimeoutMs: 30_000,
    usingTimeBank: false,
    turnSeq: 40,
    deckCommitment: '',
    awards: [],
    startStacks: null,
    ...patch,
  };
}

/** The viewer sits in seat 1; seat 2 is the opponent. */
function table(
  h: Partial<HandState>,
  me: Partial<SeatState> = {},
  legalActions: LegalAction[] = [],
): TableState {
  return {
    ...initialTableState('t1', ME),
    ready: true,
    seq: 50,
    mySeat: 1,
    seats: { 1: seat(1, ME, me), 2: seat(2, 'opp-0000') },
    hand: hand(h),
    legalActions,
  };
}

const facingBet: LegalAction[] = [
  { kind: 'FOLD' },
  { kind: 'CALL', amount: 40 },
  { kind: 'RAISE', minTo: 80, maxTo: 1_000 },
  { kind: 'ALL_IN', amount: 1_000 },
];
const unopened: LegalAction[] = [
  { kind: 'FOLD' },
  { kind: 'CHECK' },
  { kind: 'BET', minTo: 10, maxTo: 1_000 },
  { kind: 'ALL_IN', amount: 1_000 },
];

describe('preActionContext', () => {
  it('describes the viewer while an opponent acts', () => {
    expect(preActionContext(table({ currentBet: 40 }))).toEqual({
      handNo: 7,
      street: 'FLOP',
      toCall: 40,
    });
  });

  it('caps the amount to call at the stack', () => {
    expect(preActionContext(table({ currentBet: 5_000 }, { stack: 300 }))?.toCall).toBe(300);
  });

  it('does not apply on the viewer’s turn, when folded, all-in or after the hand', () => {
    expect(preActionContext(table({ toActSeat: 1 }, {}, unopened))).toBeNull();
    expect(preActionContext(table({}, { folded: true }))).toBeNull();
    expect(preActionContext(table({}, { allIn: true }))).toBeNull();
    expect(preActionContext(table({}, { inHand: false }))).toBeNull();
    expect(preActionContext(table({ street: 'COMPLETE' }))).toBeNull();
    expect(preActionContext({ ...table({}), stale: true })).toBeNull();
  });
});

describe('availablePreActions', () => {
  it('offers check options when nothing is bet and call options facing a bet', () => {
    expect(availablePreActions({ handNo: 1, street: 'FLOP', toCall: 0 })).toEqual([
      'CHECK_FOLD',
      'CHECK',
      'CALL_ANY',
    ]);
    expect(availablePreActions({ handNo: 1, street: 'FLOP', toCall: 40 })).toEqual([
      'FOLD',
      'CALL',
      'CALL_ANY',
    ]);
  });
});

describe('preActionStillValid', () => {
  const ctx = { handNo: 7, street: 'FLOP' as const, toCall: 0 };

  it('ends every pre-action with its street and hand', () => {
    for (const kind of ['CHECK_FOLD', 'CHECK', 'CALL_ANY', 'FOLD', 'CALL'] as const) {
      const pre: PreAction = { ...ctx, kind };
      expect(preActionStillValid(pre, { ...ctx, street: 'TURN' })).toBe(false);
      expect(preActionStillValid(pre, { ...ctx, handNo: 8 })).toBe(false);
      expect(preActionStillValid(pre, null)).toBe(false);
    }
  });

  it('ends "Check" when a bet is made and "Call" when the amount changes', () => {
    expect(preActionStillValid({ ...ctx, kind: 'CHECK' }, ctx)).toBe(true);
    expect(preActionStillValid({ ...ctx, kind: 'CHECK' }, { ...ctx, toCall: 40 })).toBe(false);
    const call: PreAction = { ...ctx, toCall: 40, kind: 'CALL' };
    expect(preActionStillValid(call, { ...ctx, toCall: 40 })).toBe(true);
    expect(preActionStillValid(call, { ...ctx, toCall: 120 })).toBe(false);
  });

  it('keeps "Check/Fold" and "Call any" through bets on the same street', () => {
    expect(preActionStillValid({ ...ctx, kind: 'CHECK_FOLD' }, { ...ctx, toCall: 40 })).toBe(true);
    expect(preActionStillValid({ ...ctx, kind: 'CALL_ANY' }, { ...ctx, toCall: 900 })).toBe(true);
  });
});

describe('resolvePreAction', () => {
  const pre = (kind: PreAction['kind'], toCall = 0): PreAction => ({
    kind,
    handNo: 7,
    street: 'FLOP',
    toCall,
  });
  const myTurn = (legal: LegalAction[], h: Partial<HandState> = {}) =>
    table({ toActSeat: 1, ...h }, {}, legal);

  it('checks when it can and folds otherwise for "Check/Fold"', () => {
    expect(resolvePreAction(pre('CHECK_FOLD'), myTurn(unopened))).toEqual({ kind: 'CHECK' });
    expect(resolvePreAction(pre('CHECK_FOLD'), myTurn(facingBet))).toEqual({ kind: 'FOLD' });
  });

  it('calls only the amount chosen for "Call", any amount for "Call any"', () => {
    expect(resolvePreAction(pre('CALL', 40), myTurn(facingBet))).toEqual({ kind: 'CALL' });
    expect(resolvePreAction(pre('CALL', 20), myTurn(facingBet))).toBeNull();
    expect(resolvePreAction(pre('CALL_ANY'), myTurn(facingBet))).toEqual({ kind: 'CALL' });
    expect(resolvePreAction(pre('CALL_ANY'), myTurn(unopened))).toEqual({ kind: 'CHECK' });
  });

  it('never turns "Check" into a call or a fold', () => {
    expect(resolvePreAction(pre('CHECK'), myTurn(unopened))).toEqual({ kind: 'CHECK' });
    expect(resolvePreAction(pre('CHECK'), myTurn(facingBet))).toBeNull();
  });

  it('folds for "Fold"', () => {
    expect(resolvePreAction(pre('FOLD', 40), myTurn(facingBet))).toEqual({ kind: 'FOLD' });
  });

  it('does nothing outside the viewer’s turn or after the street moved on', () => {
    expect(resolvePreAction(pre('CHECK_FOLD'), table({}, {}, unopened))).toBeNull();
    expect(resolvePreAction(pre('CHECK_FOLD'), myTurn(unopened, { street: 'TURN' }))).toBeNull();
    expect(resolvePreAction(pre('CHECK_FOLD'), myTurn(unopened, { handNo: 8 }))).toBeNull();
  });
});
