// Code generated from openapi/realtime.yaml by scripts/generate.mjs. DO NOT EDIT.
/* eslint-disable */
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @description Re-authenticates a live connection with a fresh access token before the current one expires. */
    Auth: {
      accessToken: string;
      /** @enum {string} */
      type: 'AUTH';
    };
    BlindPostedEvent: {
      allIn: boolean;
      /** Format: int64 */
      amount: number;
      /** @enum {string} */
      blind: 'SMALL' | 'BIG';
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'BLIND_POSTED';
      /** Format: int64 */
      pot: number;
      seat: number;
      /** Format: int64 */
      stack: number;
    };
    /** @description Rank + suit, e.g. "As", "Td", "2c". */
    Card: string;
    CardsRevealedEvent: {
      bestFive: components['schemas']['Card'][];
      cards: components['schemas']['Card'][];
      description: string;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'CARDS_REVEALED';
      seat: number;
    };
    /** @enum {string} */
    ClientMessageType:
      'HELLO' | 'AUTH' | 'SUBSCRIBE_TABLE' | 'UNSUBSCRIBE_TABLE' | 'COMMAND' | 'PING' | 'PONG';
    /**
     * @description Player intent. requestId (UUID) is the command's idempotency key
     *     (EventID): resending it never applies the action twice.
     */
    Command: {
      command: components['schemas']['CommandPayload'];
      /**
       * Format: int64
       * @description Last seq the client has applied; stale values are rejected with STALE_GAME_STATE.
       */
      expectedSeq?: number;
      /** Format: uuid */
      requestId: string;
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'COMMAND';
    };
    CommandError: {
      /** @description An ErrorCode value from the control-api contract. */
      code: string;
      details?: {
        [key: string]: unknown;
      };
      message: string;
    };
    CommandPayload: {
      /**
       * Format: int64
       * @description BET/RAISE "to" amount (total street commitment after the action).
       */
      amount?: number;
      /** @enum {string} */
      kind: 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN' | 'SIT_OUT' | 'SIT_IN';
    };
    CommandResult: {
      accepted: boolean;
      duplicate: boolean;
      error?: components['schemas']['CommandError'];
      /** Format: uuid */
      requestId: string;
      /**
       * Format: int64
       * @description Seq of the first event produced by the command (or the table seq at rejection).
       */
      seq: number;
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'COMMAND_RESULT';
    };
    HandCompletedEvent: {
      board: components['schemas']['Card'][];
      /** Format: uuid */
      handId: string;
      /** Format: int64 */
      handNo: number;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'HAND_COMPLETED';
      results: components['schemas']['HandResult'][];
      showdown: boolean;
    };
    HandPlayer: {
      seat: number;
      /** Format: int64 */
      stack: number;
      /** Format: uuid */
      userId: string;
    };
    HandResult: {
      /** Format: int64 */
      contributed: number;
      folded: boolean;
      /** Format: int64 */
      net: number;
      seat: number;
      /** Format: int64 */
      stack: number;
      /** Format: uuid */
      userId: string;
      /** Format: int64 */
      won: number;
    };
    HandStartedEvent: {
      /** Format: int64 */
      bigBlind: number;
      bigBlindSeat: number;
      buttonSeat: number;
      deckCommitment: string;
      /** Format: uuid */
      handId: string;
      /** Format: int64 */
      handNo: number;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'HAND_STARTED';
      players: components['schemas']['HandPlayer'][];
      /** Format: int64 */
      smallBlind: number;
      smallBlindSeat: number;
    };
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
    HandVoidedEvent: {
      /** Format: uuid */
      handId: string;
      /** Format: int64 */
      handNo: number;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'HAND_VOIDED';
      reason: string;
    };
    /** @description First client frame (within 10 s). Authenticates the connection. */
    Hello: {
      accessToken: string;
      clientVersion: string;
      deviceId?: string;
      /** @enum {string} */
      type: 'HELLO';
    };
    HoleCardsDealtEvent: {
      cards?: components['schemas']['Card'][];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'HOLE_CARDS_DEALT';
      seats: number[];
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
    PlayerActedEvent: {
      /** @enum {string} */
      action: 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE';
      /** Format: int64 */
      added: number;
      allIn: boolean;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'PLAYER_ACTED';
      /** Format: int64 */
      pot: number;
      seat: number;
      /** Format: int64 */
      stack: number;
      /** Format: int64 */
      streetBet: number;
      timeout: boolean;
    };
    PlayerLeftEvent: {
      /** Format: int64 */
      cashOut: number;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'PLAYER_LEFT';
      /** @enum {string} */
      reason: 'LEFT' | 'BUSTED' | 'TABLE_CLOSED';
      seat: number;
      /** Format: uuid */
      userId: string;
    };
    PlayerSeatedEvent: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'PLAYER_SEATED';
      seat: number;
      /** Format: int64 */
      stack: number;
      /** Format: uuid */
      userId: string;
      username: string;
    };
    PlayerSittingOutEvent: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'PLAYER_SITTING_OUT';
      /** @enum {string} */
      reason?: 'TIMEOUTS' | 'REQUEST' | 'LEAVING';
      seat: number;
      sittingOut: boolean;
      /** Format: uuid */
      userId: string;
    };
    Pong: {
      nonce?: string;
      /** @enum {string} */
      type: 'PONG';
    };
    PotAwardedEvent: {
      /** Format: int64 */
      amount: number;
      description: string;
      eligibleSeats: number[];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'POT_AWARDED';
      potIndex: number;
      winners: components['schemas']['WinnerShare'][];
    };
    /** @description Connection- or subscription-level error (not tied to a table command). */
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
    /** @description The client fell outside the retained event window; a TABLE_SNAPSHOT follows. */
    ResyncRequired: {
      /** Format: int64 */
      currentSeq: number;
      /** @enum {string} */
      reason: 'EVENTS_NOT_RETAINED' | 'SEQUENCE_GAP' | 'FEED_RESET';
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'RESYNC_REQUIRED';
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
      | 'SUBSCRIBED'
      | 'TABLE_SNAPSHOT'
      | 'TABLE_EVENT'
      | 'COMMAND_RESULT'
      | 'RESYNC_REQUIRED'
      | 'ERROR'
      | 'PING'
      | 'PONG';
    StreetDealtEvent: {
      board: components['schemas']['Card'][];
      cards: components['schemas']['Card'][];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'STREET_DEALT';
      /** @enum {string} */
      street: 'FLOP' | 'TURN' | 'RIVER';
    };
    /** @description Subscription is live; `replayed` events were sent before it (REPLAY mode). */
    Subscribed: {
      /** @enum {string} */
      mode: 'SNAPSHOT' | 'REPLAY';
      replayed: number;
      requestId?: string;
      /** Format: int64 */
      seq: number;
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'SUBSCRIBED';
    };
    /**
     * @description Subscribe to a table. With lastSeenSeq the server replays missed
     *     events if they are retained, otherwise it sends RESYNC_REQUIRED and a
     *     fresh TABLE_SNAPSHOT. Without lastSeenSeq a TABLE_SNAPSHOT is sent.
     */
    SubscribeTable: {
      /** Format: int64 */
      lastSeenSeq?: number;
      requestId?: string;
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'SUBSCRIBE_TABLE';
    };
    /**
     * @description The table accepts no new hands or players. Seated players are cashed
     *     out to their club wallets (PLAYER_LEFT reason TABLE_CLOSED) as soon as
     *     no hand is in progress.
     */
    TableClosedEvent: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'TABLE_CLOSED';
    };
    TableEventMessage: {
      event: components['schemas']['TableEventPayload'];
      /** Format: uuid */
      handId?: string;
      /** Format: int64 */
      seq: number;
      /** Format: date-time */
      serverTime: string;
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'TABLE_EVENT';
    };
    /** @description Ordered table event (discriminated by kind). Private fields only appear in the recipient's copy. */
    TableEventPayload:
      | components['schemas']['PlayerSeatedEvent']
      | components['schemas']['PlayerLeftEvent']
      | components['schemas']['PlayerSittingOutEvent']
      | components['schemas']['HandStartedEvent']
      | components['schemas']['BlindPostedEvent']
      | components['schemas']['HoleCardsDealtEvent']
      | components['schemas']['PlayerActedEvent']
      | components['schemas']['TurnStartedEvent']
      | components['schemas']['UncalledBetReturnedEvent']
      | components['schemas']['StreetDealtEvent']
      | components['schemas']['CardsRevealedEvent']
      | components['schemas']['PotAwardedEvent']
      | components['schemas']['HandCompletedEvent']
      | components['schemas']['HandVoidedEvent']
      | components['schemas']['TableClosedEvent'];
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
    TableSnapshotMessage: {
      /** Format: int64 */
      seq: number;
      snapshot: components['schemas']['TableSnapshot'];
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'TABLE_SNAPSHOT';
    };
    TurnStartedEvent: {
      /** Format: int64 */
      currentBet: number;
      /** Format: date-time */
      deadline: string;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'TURN_STARTED';
      /** @description Private to the acting player. */
      legalActions?: components['schemas']['LegalAction'][];
      /** Format: int64 */
      minRaise: number;
      /** Format: int64 */
      pot: number;
      seat: number;
      /** @enum {string} */
      street: 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER';
      /** Format: int64 */
      timeoutMs: number;
    };
    UncalledBetReturnedEvent: {
      /** Format: int64 */
      amount: number;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'UNCALLED_BET_RETURNED';
      /** Format: int64 */
      pot: number;
      seat: number;
      /** Format: int64 */
      stack: number;
    };
    UnsubscribeTable: {
      /** Format: uuid */
      tableId: string;
      /** @enum {string} */
      type: 'UNSUBSCRIBE_TABLE';
    };
    Welcome: {
      connectionId: string;
      heartbeatIntervalMs: number;
      /** Format: date-time */
      serverTime: string;
      /** Format: date-time */
      tokenExpiresAt: string;
      /** @enum {string} */
      type: 'WELCOME';
      /** Format: uuid */
      userId: string;
    };
    WinnerShare: {
      /** Format: int64 */
      amount: number;
      seat: number;
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
