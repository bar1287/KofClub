// Code generated from openapi/realtime.yaml by scripts/generate.mjs. DO NOT EDIT.
/* eslint-disable */
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @description Rank + suit, e.g. "As", "Td", "2c". */
    Card: string;
    /** @enum {string} */
    ClientMessageType:
      'HELLO' | 'SUBSCRIBE_TABLE' | 'UNSUBSCRIBE_TABLE' | 'COMMAND' | 'PING' | 'PONG';
    HandView: {
      /** Format: date-time */
      actionDeadline: string | null;
      bigBlindSeat: number;
      board: components['schemas']['Card'][];
      buttonSeat: number;
      /** Format: int64 */
      currentBet: number;
      /** @description SHA-256 commitment to the deck order (audit). */
      deckCommitment: string;
      /** Format: uuid */
      handId: string;
      /** Format: int64 */
      handNo: number;
      /** Format: int64 */
      minRaise: number;
      /** Format: int64 */
      pot: number;
      smallBlindSeat: number;
      /** @enum {string} */
      street: 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'COMPLETE';
      /** @description 0 when nobody is to act. */
      toActSeat: number;
      /**
       * Format: int64
       * @description Sequence of the TURN_STARTED event of the current turn.
       */
      turnSeq: number;
    };
    /** @description First client frame. Authenticates the connection. */
    Hello: {
      accessToken: string;
      clientVersion: string;
      deviceId?: string;
      /** @enum {string} */
      type: 'HELLO';
    };
    LegalAction: {
      /**
       * Format: int64
       * @description CALL - chips to add; ALL_IN - resulting street commitment.
       */
      amount?: number;
      /** @enum {string} */
      kind: 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN';
      /**
       * Format: int64
       * @description BET/RAISE maximum "to" amount (all-in).
       */
      maxTo?: number;
      /**
       * Format: int64
       * @description BET/RAISE minimum "to" amount.
       */
      minTo?: number;
    };
    Ping: {
      nonce?: string;
      /** @enum {string} */
      type: 'PING';
    };
    Pong: {
      nonce?: string;
      /** @enum {string} */
      type: 'PONG';
    };
    /** @description Connection-level error (not tied to a table command). */
    ProtocolError: {
      /** @description An ErrorCode value from the control-api contract. */
      code: string;
      message: string;
      requestId?: string;
      /** Format: uuid */
      tableId?: string;
      /** @enum {string} */
      type: 'ERROR';
    };
    SeatView: {
      allIn: boolean;
      folded: boolean;
      inHand: boolean;
      leaving: boolean;
      seat: number;
      /** @description Cards revealed at showdown (public). */
      shownCards?: components['schemas']['Card'][];
      sittingOut: boolean;
      /** Format: int64 */
      stack: number;
      /** Format: int64 */
      streetBet: number;
      /** Format: uuid */
      userId: string;
      username: string;
    };
    /** @enum {string} */
    ServerMessageType:
      | 'WELCOME'
      | 'TABLE_SNAPSHOT'
      | 'TABLE_EVENT'
      | 'COMMAND_RESULT'
      | 'RESYNC_REQUIRED'
      | 'ERROR'
      | 'PING'
      | 'PONG';
    TableInfo: {
      /** Format: int64 */
      actionTimeoutMs: number;
      /** Format: int64 */
      bigBlind: number;
      /** Format: int64 */
      buyInMax: number;
      /** Format: int64 */
      buyInMin: number;
      /** Format: uuid */
      clubId: string;
      maxSeats: number;
      name: string;
      /** Format: int64 */
      smallBlind: number;
      /** @enum {string} */
      status: 'OPEN' | 'CLOSED';
    };
    /** @description Complete viewer-sanitized table state; clients replace (never merge) state with it. */
    TableSnapshot: {
      /** @description Present while a hand is in progress or just completed. */
      hand?: components['schemas']['HandView'];
      /** @enum {string} */
      phase: 'WAITING_FOR_PLAYERS' | 'HAND_IN_PROGRESS' | 'HAND_COMPLETE';
      seats: components['schemas']['SeatView'][];
      /** Format: int64 */
      seq: number;
      /** Format: date-time */
      serverTime: string;
      table: components['schemas']['TableInfo'];
      /** Format: uuid */
      tableId: string;
      /** @description The viewer's private view (absent for anonymous spectators). */
      you?: components['schemas']['YouView'];
    };
    Welcome: {
      connectionId: string;
      heartbeatIntervalMs: number;
      /** Format: date-time */
      serverTime: string;
      /** @enum {string} */
      type: 'WELCOME';
      /** Format: uuid */
      userId: string;
    };
    YouView: {
      holeCards: components['schemas']['Card'][];
      legalActions: components['schemas']['LegalAction'][];
      /** @description 0 when the viewer is not seated. */
      seat: number;
      /** Format: uuid */
      userId: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
