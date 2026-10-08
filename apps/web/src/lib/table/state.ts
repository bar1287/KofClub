import { describeEvent } from './describe';
import type {
  Card,
  HandResult,
  LegalAction,
  Street,
  TableEventMessage,
  TableEventPayload,
  TableInfo,
  TablePhase,
  TableSnapshot,
  WinnerShare,
} from '../types';

/**
 * Client-side mirror of one table, built only from server frames
 * (docs/realtime-protocol.md, ADR-004). It is a *view* of authoritative
 * state: a TABLE_SNAPSHOT replaces it entirely, and TABLE_EVENTs are applied
 * strictly in seq order. Nothing here is ever sent back as truth — commands
 * carry intent only and the server re-validates everything.
 */
export interface SeatState {
  seat: number;
  userId: string;
  username: string;
  stack: number;
  sittingOut: boolean;
  leaving: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  /** Time bank left (while it runs: the value from before it started). */
  timeBankMs: number;
  /** Out of chips: the seat is released at this local time unless they re-buy. */
  bustedUntil?: number;
  /** Cards shown at showdown, or (some of them) by the player after the hand. */
  shownCards?: Card[];
  /** Hand description at showdown ("Two Pair, Kings and Fives"). */
  shownDescription?: string;
  /** Lost at showdown without showing. */
  mucked?: boolean;
  /** Last action this street (for the seat badge). */
  lastAction?: string;
}

export interface PotAward {
  potIndex: number;
  amount: number;
  winners: WinnerShare[];
  description: string;
}

export interface HandState {
  handId: string;
  handNo: number;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  bigBlind: number;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  /** 0 when nobody is to act. */
  toActSeat: number;
  /** Turn deadline converted to the local clock (ms since epoch), or null. */
  deadlineAt: number | null;
  turnTimeoutMs: number;
  /** The actor's turn timer ran out: deadlineAt is the end of their time bank. */
  usingTimeBank: boolean;
  /** Seq of the current TURN_STARTED (used as expectedSeq for commands). */
  turnSeq: number;
  deckCommitment: string;
  awards: PotAward[];
  /** Stacks at hand start; restores state when the hand is voided. */
  startStacks: Record<number, number> | null;
}

export interface HandSummary {
  handId: string;
  handNo: number;
  showdown: boolean;
  results: HandResult[];
  awards: PotAward[];
}

export interface LogEntry {
  seq: number;
  text: string;
}

/** Why the viewer left their seat (tournament moves, eliminations). */
export interface Departure {
  reason: string;
  toTableId?: string;
  place?: number;
}

export interface TableState {
  tableId: string;
  /** Last applied seq; -1 until the first snapshot. */
  seq: number;
  /** True once a snapshot has been applied. */
  ready: boolean;
  /** Continuity was lost; the client must resubscribe before trusting state. */
  stale: boolean;
  table: TableInfo | null;
  phase: TablePhase;
  /** Occupied seats keyed by seat number. */
  seats: Record<number, SeatState>;
  hand: HandState | null;
  viewerId: string | null;
  /** The viewer's seat (0 = not seated). */
  mySeat: number;
  holeCards: Card[];
  legalActions: LegalAction[];
  lastHand: HandSummary | null;
  /** Set when the viewer's seat was removed (moved, eliminated, finished). */
  departure: Departure | null;
  /** Chips the viewer added during the current hand (applied when it ends). */
  myPendingTopUp: number;
  /** The viewer's automatic top-up target (0 = off). */
  myAutoTopUpTo: number;
  /** The viewer's losing hands are mucked at showdown. */
  myMuckLosing: boolean;
  /** Presentation-only action log (not authoritative state). */
  log: LogEntry[];
}

export type TableAction =
  | { type: 'snapshot'; snapshot: TableSnapshot; receivedAt: number }
  | { type: 'event'; message: TableEventMessage; receivedAt: number }
  | { type: 'stale' }
  /** SUBSCRIBED: the stream is continuous again (after a replay or snapshot). */
  | { type: 'live'; seq: number }
  | { type: 'leaving'; leaving: boolean }
  /** The viewer's top-up settings changed through the HTTP API. */
  | { type: 'topUp'; pending?: number; autoTopUpTo?: number }
  /** The viewer's showdown preference changed through the HTTP API. */
  | { type: 'muck'; muckLosing: boolean };

const LOG_LIMIT = 60;

export function initialTableState(tableId: string, viewerId: string | null): TableState {
  return {
    tableId,
    seq: -1,
    ready: false,
    stale: false,
    table: null,
    phase: 'WAITING_FOR_PLAYERS',
    seats: {},
    hand: null,
    viewerId,
    mySeat: 0,
    holeCards: [],
    legalActions: [],
    lastHand: null,
    departure: null,
    myPendingTopUp: 0,
    myAutoTopUpTo: 0,
    myMuckLosing: true,
    log: [],
  };
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'snapshot':
      return applySnapshot(state, action.snapshot, action.receivedAt);
    case 'event': {
      const { message } = action;
      if (!state.ready || message.seq <= state.seq) return state; // duplicate/overlap
      if (message.seq !== state.seq + 1) return { ...state, stale: true }; // gap
      const next = applyEvent(state, message, action.receivedAt);
      return { ...next, seq: message.seq };
    }
    case 'stale':
      return state.stale ? state : { ...state, stale: true };
    case 'live':
      // Only trust it when every event up to the subscription point was applied.
      return state.stale && state.ready && action.seq === state.seq
        ? { ...state, stale: false }
        : state;
    case 'leaving': {
      const seat = state.seats[state.mySeat];
      if (!seat) return state;
      return {
        ...state,
        seats: { ...state.seats, [seat.seat]: { ...seat, leaving: action.leaving } },
      };
    }
    case 'topUp':
      return {
        ...state,
        myPendingTopUp: action.pending ?? state.myPendingTopUp,
        myAutoTopUpTo: action.autoTopUpTo ?? state.myAutoTopUpTo,
      };
    case 'muck':
      return { ...state, myMuckLosing: action.muckLosing };
  }
}

/** A snapshot replaces local state (ADR-004); only the log is carried over. */
export function applySnapshot(
  state: TableState,
  snap: TableSnapshot,
  receivedAt: number,
): TableState {
  const seats: Record<number, SeatState> = {};
  for (const s of snap.seats) {
    seats[s.seat] = {
      seat: s.seat,
      userId: s.userId,
      username: s.username,
      stack: s.stack,
      sittingOut: s.sittingOut,
      leaving: s.leaving,
      inHand: s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      streetBet: s.streetBet,
      timeBankMs: s.timeBankMs,
      bustedUntil: s.bustedUntil
        ? toLocalTime(s.bustedUntil, snap.serverTime, receivedAt)
        : undefined,
      shownCards: s.shownCards,
      mucked: s.mucked,
    };
  }
  let hand: HandState | null = null;
  if (snap.hand) {
    const h = snap.hand;
    hand = {
      handId: h.handId,
      handNo: h.handNo,
      street: h.street,
      board: h.board,
      pot: h.pot,
      currentBet: h.currentBet,
      minRaise: h.minRaise,
      bigBlind: snap.table.bigBlind,
      buttonSeat: h.buttonSeat,
      smallBlindSeat: h.smallBlindSeat,
      bigBlindSeat: h.bigBlindSeat,
      toActSeat: h.toActSeat,
      deadlineAt: h.actionDeadline
        ? toLocalTime(h.actionDeadline, snap.serverTime, receivedAt)
        : null,
      // A running bank lasts as long as the actor's bank was when it started.
      turnTimeoutMs: h.usingTimeBank
        ? (seats[h.toActSeat]?.timeBankMs ?? 0)
        : snap.table.actionTimeoutMs,
      usingTimeBank: h.usingTimeBank,
      turnSeq: h.turnSeq,
      deckCommitment: h.deckCommitment,
      awards: [],
      startStacks: null,
    };
  }
  const you = snap.you;
  const log = state.ready
    ? appendLog(state.log, { seq: snap.seq, text: 'State resynchronized.' })
    : state.log;
  return {
    tableId: snap.tableId,
    seq: snap.seq,
    ready: true,
    stale: false,
    table: snap.table,
    phase: snap.phase,
    seats,
    hand,
    viewerId: you?.userId ?? state.viewerId,
    mySeat: you?.seat ?? 0,
    holeCards: you?.holeCards ?? [],
    legalActions: you?.legalActions ?? [],
    lastHand: state.lastHand,
    departure: you?.seat ? null : state.departure,
    myPendingTopUp: you?.pendingTopUp ?? 0,
    myAutoTopUpTo: you?.autoTopUpTo ?? 0,
    myMuckLosing: you?.muckLosingHands ?? true,
    log,
  };
}

/** Converts a server timestamp to the local clock using the frame's server time. */
function toLocalTime(serverTs: string, serverNow: string, receivedAt: number): number {
  return receivedAt + (Date.parse(serverTs) - Date.parse(serverNow));
}

function appendLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  const next = log.length >= LOG_LIMIT ? log.slice(log.length - LOG_LIMIT + 1) : log.slice();
  next.push(entry);
  return next;
}

function nameOf(state: TableState, seat: number): string {
  return state.seats[seat]?.username ?? `Seat ${seat}`;
}

function updateSeat(
  state: TableState,
  seat: number,
  patch: Partial<SeatState>,
): Record<number, SeatState> {
  const current = state.seats[seat];
  if (!current) return state.seats;
  return { ...state.seats, [seat]: { ...current, ...patch } };
}

function mapSeats(
  seats: Record<number, SeatState>,
  fn: (s: SeatState) => SeatState,
): Record<number, SeatState> {
  const out: Record<number, SeatState> = {};
  for (const s of Object.values(seats)) out[s.seat] = fn(s);
  return out;
}

function withHand(state: TableState, patch: Partial<HandState>): HandState | null {
  return state.hand ? { ...state.hand, ...patch } : null;
}

/** Applies one in-order event. Mirrors the game service's state transitions. */
function applyEvent(state: TableState, msg: TableEventMessage, receivedAt: number): TableState {
  const ev: TableEventPayload = msg.event;
  const text = describeEvent(ev, (seat) => nameOf(state, seat));
  const log = () => (text ? appendLog(state.log, { seq: msg.seq, text }) : state.log);
  switch (ev.kind) {
    case 'PLAYER_SEATED': {
      const mine = ev.userId === state.viewerId;
      return {
        ...state,
        seats: {
          ...state.seats,
          [ev.seat]: {
            seat: ev.seat,
            userId: ev.userId,
            username: ev.username,
            stack: ev.stack,
            sittingOut: false,
            leaving: false,
            inHand: false,
            folded: false,
            allIn: false,
            streetBet: 0,
            timeBankMs: state.table?.timeBankMs ?? 0,
          },
        },
        mySeat: mine ? ev.seat : state.mySeat,
        departure: mine ? null : state.departure,
        // A new seat mucks losing hands until the player changes it.
        myMuckLosing: mine ? true : state.myMuckLosing,
        log: log(),
      };
    }
    case 'PLAYER_LEFT': {
      const seats = { ...state.seats };
      delete seats[ev.seat];
      const mine = ev.userId === state.viewerId;
      return {
        ...state,
        seats,
        mySeat: mine ? 0 : state.mySeat,
        holeCards: mine ? [] : state.holeCards,
        legalActions: mine ? [] : state.legalActions,
        myPendingTopUp: mine ? 0 : state.myPendingTopUp,
        myAutoTopUpTo: mine ? 0 : state.myAutoTopUpTo,
        departure: mine
          ? { reason: ev.reason, toTableId: ev.toTableId, place: ev.place }
          : state.departure,
        log: log(),
      };
    }
    case 'PLAYER_SITTING_OUT': {
      const patch: Partial<SeatState> = { sittingOut: ev.sittingOut };
      if (ev.reason === 'LEAVING') patch.leaving = true;
      patch.bustedUntil =
        ev.reason === 'BUSTED' && ev.until
          ? toLocalTime(ev.until, msg.serverTime, receivedAt)
          : undefined;
      return {
        ...state,
        seats: updateSeat(state, ev.seat, patch),
        log: log(),
      };
    }
    case 'PLAYER_TOPPED_UP': {
      const mine = state.seats[ev.seat]?.userId === state.viewerId && state.viewerId !== null;
      return {
        ...state,
        seats: updateSeat(state, ev.seat, { stack: ev.stack, bustedUntil: undefined }),
        myPendingTopUp: mine ? 0 : state.myPendingTopUp,
        log: log(),
      };
    }
    case 'HAND_STARTED': {
      const startStacks: Record<number, number> = {};
      const banks: Record<number, number> = {};
      for (const p of ev.players) {
        startStacks[p.seat] = p.stack;
        banks[p.seat] = p.timeBankMs;
      }
      const seats = mapSeats(state.seats, (s) => {
        const start = startStacks[s.seat];
        return {
          ...s,
          stack: start ?? s.stack,
          timeBankMs: banks[s.seat] ?? s.timeBankMs,
          inHand: start !== undefined,
          folded: false,
          allIn: false,
          streetBet: 0,
          shownCards: undefined,
          shownDescription: undefined,
          mucked: undefined,
          lastAction: undefined,
        };
      });
      // Tournament tables: the hand's level and blinds.
      const table =
        state.table && ev.tournament
          ? {
              ...state.table,
              tournament: ev.tournament,
              smallBlind: ev.smallBlind,
              bigBlind: ev.bigBlind,
            }
          : state.table;
      return {
        ...state,
        table,
        phase: 'HAND_IN_PROGRESS',
        seats,
        hand: {
          handId: ev.handId,
          handNo: ev.handNo,
          street: 'PREFLOP',
          board: [],
          pot: 0,
          currentBet: 0,
          minRaise: ev.bigBlind,
          bigBlind: ev.bigBlind,
          buttonSeat: ev.buttonSeat,
          smallBlindSeat: ev.smallBlindSeat,
          bigBlindSeat: ev.bigBlindSeat,
          toActSeat: 0,
          deadlineAt: null,
          turnTimeoutMs: state.table?.actionTimeoutMs ?? 0,
          usingTimeBank: false,
          turnSeq: state.hand?.turnSeq ?? 0,
          deckCommitment: ev.deckCommitment,
          awards: [],
          startStacks,
        },
        holeCards: [],
        legalActions: [],
        // A top-up still pending at the next hand was dropped by the server.
        myPendingTopUp: 0,
        log: log(),
      };
    }
    case 'BLIND_POSTED':
      return {
        ...state,
        seats: updateSeat(state, ev.seat, {
          stack: ev.stack,
          streetBet: ev.amount,
          allIn: ev.allIn,
        }),
        hand: withHand(state, {
          pot: ev.pot,
          currentBet: Math.max(state.hand?.currentBet ?? 0, ev.amount),
        }),
        log: log(),
      };
    case 'HOLE_CARDS_DEALT':
      return { ...state, holeCards: ev.cards ?? state.holeCards };
    case 'TURN_STARTED': {
      const mine = ev.seat === state.mySeat && state.mySeat !== 0;
      return {
        ...state,
        seats: updateSeat(state, ev.seat, { timeBankMs: ev.timeBankMs }),
        hand: withHand(state, {
          toActSeat: ev.seat,
          street: ev.street,
          currentBet: ev.currentBet,
          minRaise: ev.minRaise,
          pot: ev.pot,
          deadlineAt: toLocalTime(ev.deadline, msg.serverTime, receivedAt),
          turnTimeoutMs: ev.timeoutMs,
          usingTimeBank: false,
          turnSeq: msg.seq,
        }),
        legalActions: mine ? (ev.legalActions ?? []) : [],
      };
    }
    case 'TIME_BANK_STARTED':
      return {
        ...state,
        hand: withHand(state, {
          deadlineAt: toLocalTime(ev.deadline, msg.serverTime, receivedAt),
          turnTimeoutMs: ev.timeoutMs,
          usingTimeBank: true,
        }),
        log: log(),
      };
    case 'PLAYER_ACTED': {
      return {
        ...state,
        seats: updateSeat(state, ev.seat, {
          stack: ev.stack,
          streetBet: ev.streetBet,
          allIn: ev.allIn,
          folded: ev.action === 'FOLD' || state.seats[ev.seat]?.folded === true,
          lastAction: ev.allIn ? 'ALL-IN' : ev.action,
          ...(ev.timeBankMs !== undefined ? { timeBankMs: ev.timeBankMs } : {}),
        }),
        hand: withHand(state, {
          pot: ev.pot,
          currentBet: Math.max(state.hand?.currentBet ?? 0, ev.streetBet),
          toActSeat: 0,
          deadlineAt: null,
          usingTimeBank: false,
        }),
        legalActions: ev.seat === state.mySeat ? [] : state.legalActions,
        log: log(),
      };
    }
    case 'UNCALLED_BET_RETURNED': {
      const seat = state.seats[ev.seat];
      return {
        ...state,
        seats: updateSeat(state, ev.seat, {
          stack: ev.stack,
          streetBet: Math.max(0, (seat?.streetBet ?? 0) - ev.amount),
        }),
        hand: withHand(state, { pot: ev.pot }),
        log: log(),
      };
    }
    case 'STREET_DEALT':
      return {
        ...state,
        seats: mapSeats(state.seats, (s) => ({ ...s, streetBet: 0, lastAction: undefined })),
        hand: withHand(state, {
          street: ev.street,
          board: ev.board,
          currentBet: 0,
          toActSeat: 0,
          deadlineAt: null,
        }),
        log: log(),
      };
    case 'CARDS_REVEALED':
      return {
        ...state,
        seats: updateSeat(state, ev.seat, {
          shownCards: ev.cards,
          shownDescription: ev.description,
        }),
        log: log(),
      };
    case 'CARDS_MUCKED':
      return { ...state, seats: updateSeat(state, ev.seat, { mucked: true }), log: log() };
    case 'CARDS_SHOWN': {
      const before = state.seats[ev.seat]?.shownCards ?? [];
      return {
        ...state,
        seats: updateSeat(state, ev.seat, {
          shownCards: [...before, ...ev.cards.filter((c) => !before.includes(c))],
        }),
        log: log(),
      };
    }
    case 'POT_AWARDED': {
      let seats = mapSeats(state.seats, (s) => ({ ...s, streetBet: 0 }));
      for (const w of ev.winners) {
        const s = seats[w.seat];
        if (s) seats = { ...seats, [w.seat]: { ...s, stack: s.stack + w.amount } };
      }
      const award: PotAward = {
        potIndex: ev.potIndex,
        amount: ev.amount,
        winners: ev.winners,
        description: ev.description,
      };
      return {
        ...state,
        seats,
        hand: withHand(state, {
          pot: Math.max(0, (state.hand?.pot ?? 0) - ev.amount),
          awards: [...(state.hand?.awards ?? []), award],
          toActSeat: 0,
          deadlineAt: null,
        }),
        log: log(),
      };
    }
    case 'HAND_COMPLETED': {
      const byseat = new Map(ev.results.map((r) => [r.seat, r]));
      const seats = mapSeats(state.seats, (s) => {
        const r = byseat.get(s.seat);
        const base = { ...s, lastAction: undefined };
        return r && r.userId === s.userId ? { ...base, stack: r.stack, streetBet: 0 } : base;
      });
      return {
        ...state,
        // The server returns to WAITING_FOR_PLAYERS as part of settlement.
        phase: 'WAITING_FOR_PLAYERS',
        seats,
        hand: withHand(state, {
          street: 'COMPLETE',
          board: ev.board,
          pot: 0,
          toActSeat: 0,
          deadlineAt: null,
        }),
        legalActions: [],
        lastHand: {
          handId: ev.handId,
          handNo: ev.handNo,
          showdown: ev.showdown,
          results: ev.results,
          awards: state.hand?.awards ?? [],
        },
        log: log(),
      };
    }
    case 'TABLE_CLOSED':
      return {
        ...state,
        table: state.table ? { ...state.table, status: 'CLOSED' } : state.table,
        log: log(),
      };
    case 'HAND_VOIDED': {
      const start = state.hand?.startStacks;
      const base: TableState = {
        ...state,
        phase: 'WAITING_FOR_PLAYERS',
        hand: null,
        holeCards: [],
        legalActions: [],
        log: log(),
      };
      if (!start) return { ...base, stale: true }; // joined mid-hand: resync for stacks
      return {
        ...base,
        seats: mapSeats(state.seats, (s) => ({
          ...s,
          stack: start[s.seat] ?? s.stack,
          inHand: false,
          folded: false,
          allIn: false,
          streetBet: 0,
          shownCards: undefined,
          shownDescription: undefined,
          mucked: undefined,
          lastAction: undefined,
        })),
      };
    }
  }
}

/** Seats ordered by number. */
export function seatList(state: TableState): SeatState[] {
  return Object.values(state.seats).sort((a, b) => a.seat - b.seat);
}

/** Total chips at the table: stacks plus the pot (which includes this street's bets). */
export function chipsInPlay(state: TableState): number {
  return Object.values(state.seats).reduce((sum, s) => sum + s.stack, 0) + (state.hand?.pot ?? 0);
}
