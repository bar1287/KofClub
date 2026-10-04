// Code generated from openapi/control-api.yaml by scripts/generate.mjs. DO NOT EDIT.
/* eslint-disable */
export type paths = {
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Liveness probe */
    get: operations['getHealthLive'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Readiness probe (checks PostgreSQL and Redis) */
    get: operations['getHealthReady'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/audit-log': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Platform-wide audit log (PLATFORM_ADMIN) */
    get: operations['adminAuditLog'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/clubs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search clubs (PLATFORM_ADMIN) */
    get: operations['adminSearchClubs'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/clubs/{clubId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Suspend (view-only) or reinstate a club (PLATFORM_ADMIN) */
    patch: operations['adminSetClubStatus'];
    trace?: never;
  };
  '/v1/admin/overview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Platform operational overview (PLATFORM_ADMIN) */
    get: operations['adminOverview'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/risk-events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Risk cases awaiting (OPEN) or after (REVIEWED) review (PLATFORM_ADMIN) */
    get: operations['adminRiskEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/risk-events/{eventId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        eventId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Record a review disposition (evidence stays immutable) (PLATFORM_ADMIN) */
    patch: operations['adminReviewRiskEvent'];
    trace?: never;
  };
  '/v1/admin/users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search accounts (PLATFORM_ADMIN) */
    get: operations['adminSearchUsers'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/users/{userId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        userId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Suspend or reinstate an account; suspension revokes every session (PLATFORM_ADMIN) */
    patch: operations['adminSetUserStatus'];
    trace?: never;
  };
  '/v1/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Issue access + refresh tokens */
    post: operations['login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Revoke the current session */
    post: operations['logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/refresh': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Rotate the refresh token (reuse revokes the session)
     * @description The refresh token is read from the body or, for browser clients, from
     *     the HttpOnly `kof_rt` cookie. Presenting an already-rotated token
     *     revokes the session (`AUTH_REFRESH_REUSED`).
     */
    post: operations['refresh'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create an account and a first session */
    post: operations['register'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Clubs I am an active member of */
    get: operations['listMyClubs'];
    put?: never;
    /** Create a club (caller becomes OWNER) */
    post: operations['createClub'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Club details */
    get: operations['getClub'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Rename the club or edit its description (OWNER) */
    patch: operations['updateClub'];
    trace?: never;
  };
  '/v1/clubs/{clubId}/audit-log': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Privileged-action audit log (ADMIN+, platform admins) */
    get: operations['listClubAuditLog'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/chips/deductions': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Return a member's chips to the club treasury (ADMIN+) */
    post: operations['deductChips'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/chips/grants': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Grant virtual chips from the club treasury to a member (ADMIN+) */
    post: operations['grantChips'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/hands': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Finished hands in a club (ADMIN+ audit view, newest first) */
    get: operations['listClubHands'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/invites': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** List invites (codes are never returned) */
    get: operations['listClubInvites'];
    put?: never;
    /** Create an invite code (AGENT+; AGENT-role invites need ADMIN+) */
    post: operations['createClubInvite'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/invites/{inviteId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
        inviteId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke an invite */
    delete: operations['revokeClubInvite'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/join': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Join this club by join code or invite code */
    post: operations['joinClub'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/join-code/rotate': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Replace the club join code (ADMIN+) */
    post: operations['rotateClubJoinCode'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/leave': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Leave the club (owners cannot leave) */
    post: operations['leaveClub'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/ledger/balances': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Member wallet and table balances (ADMIN+) */
    get: operations['listMemberBalances'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/ledger/summary': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Chips in circulation (ADMIN+, platform admins) */
    get: operations['getLedgerSummary'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/ledger/transactions': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Club ledger transactions with entries (ADMIN+) */
    get: operations['listLedgerTransactions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/ledger/transactions/{txId}/reversal': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
        txId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Reverse an administrative chip movement (ADMIN+) */
    post: operations['reverseLedgerTransaction'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/members': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Members (keyset-paginated) */
    get: operations['listClubMembers'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/members/{userId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
        userId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Change a member's role or status (ban/unban) */
    patch: operations['updateClubMember'];
    trace?: never;
  };
  '/v1/clubs/{clubId}/tables': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Tables of a club */
    get: operations['listClubTables'];
    put?: never;
    /** Create a No-Limit Hold'em table (ADMIN+) */
    post: operations['createTable'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/tournaments': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** Tournaments of a club, newest first */
    get: operations['listClubTournaments'];
    put?: never;
    /** Create a tournament and its tables (ADMIN+) */
    post: operations['createTournament'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/transfer-ownership': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Hand the club to another active member (OWNER); the previous owner becomes ADMIN */
    post: operations['transferClubOwnership'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/wallet': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** My virtual-chip wallet balance in this club */
    get: operations['getMyWallet'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/{clubId}/wallet/entries': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    /** My wallet movements (newest first) */
    get: operations['listMyWalletEntries'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/clubs/join': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Join a club with a club join code or an invite code */
    post: operations['joinClubByCode'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/hands/{handId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        handId: components['parameters']['HandId'];
      };
      cookie?: never;
    };
    /**
     * Visible hand record (ADR-008 visibility policy)
     * @description Participants see the public action log, the board, cards shown at
     *     showdown and their own hole cards. Club staff (ADMIN+) and platform
     *     admins see the same public record without anyone's unrevealed cards.
     *     Anyone else receives HAND_NOT_FOUND.
     */
    get: operations['getHand'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Current profile */
    get: operations['getMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/hands': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Hands I was dealt into (finished hands, newest first) */
    get: operations['listMyHands'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List active sessions/devices */
    get: operations['listMySessions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/sessions/{sessionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke one of my sessions */
    delete: operations['revokeMySession'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tables/{tableId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    /** Table configuration and seated players */
    get: operations['getTable'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tables/{tableId}/close': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Close the table for good (ADMIN+); seated players are cashed out to their wallets
     * @description No new hands are dealt. When no hand is in progress every seat is
     *     cashed out immediately (status CLOSED); otherwise after the current
     *     hand (status CLOSING). Safe to retry.
     */
    post: operations['closeTable'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tables/{tableId}/leave': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Leave the table; the stack is cashed out to the club wallet (after the current hand if needed) */
    post: operations['leaveTable'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tables/{tableId}/seat': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Buy in from the club wallet and take a seat
     * @description The Idempotency-Key (if given) makes retried buy-ins safe.
     */
    post: operations['takeSeat'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tables/{tableId}/state': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    /** Viewer-sanitized table snapshot (realtime clients use TABLE_SNAPSHOT instead) */
    get: operations['getTableState'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tournaments/{tournamentId}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    /** Structure, prize pool, payouts and entrants (live places and tables) */
    get: operations['getTournament'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tournaments/{tournamentId}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Cancel before the start (ADMIN+); every buy-in is refunded */
    post: operations['cancelTournament'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tournaments/{tournamentId}/register': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Register, paying the buy-in from the club wallet into the prize pool */
    post: operations['registerForTournament'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tournaments/{tournamentId}/start': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Start now with the registered players (ADMIN+; at least minPlayers)
     * @description The game service seats the players within about a second.
     */
    post: operations['startTournament'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tournaments/{tournamentId}/unregister': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Unregister before the start; the buy-in is refunded */
    post: operations['unregisterFromTournament'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    AdminClub: {
      createdAt: components['schemas']['Timestamp'];
      id: components['schemas']['Uuid'];
      memberCount: number;
      name: string;
      openTables: number;
      ownerUserId: components['schemas']['Uuid'];
      ownerUsername: string;
      status: components['schemas']['ClubStatus'];
    };
    AdminClubPage: {
      items: components['schemas']['AdminClub'][];
      nextCursor: string | null;
    };
    AdminUser: {
      activeSessions: number;
      clubCount: number;
      createdAt: components['schemas']['Timestamp'];
      email: string;
      id: components['schemas']['Uuid'];
      platformRole: components['schemas']['PlatformRole'];
      status: components['schemas']['UserStatus'];
      username: string;
    };
    AdminUserPage: {
      items: components['schemas']['AdminUser'][];
      nextCursor: string | null;
    };
    AuditPage: {
      items: components['schemas']['AuditRecord'][];
      nextCursor: string | null;
    };
    AuditRecord: {
      action: string;
      /** Format: uuid */
      actorUserId: string | null;
      actorUsername: string | null;
      after: {
        [key: string]: unknown;
      } | null;
      before: {
        [key: string]: unknown;
      } | null;
      /** Format: uuid */
      clubId: string | null;
      createdAt: components['schemas']['Timestamp'];
      id: components['schemas']['Uuid'];
      objectId: string | null;
      objectType: string;
      requestId: string | null;
    };
    AuthResult: {
      /** @description EdDSA JWT, ~15 minutes */
      accessToken: string;
      accessTokenExpiresAt: components['schemas']['Timestamp'];
      /** @description Opaque token; omitted when cookie transport is used */
      refreshToken?: string;
      refreshTokenExpiresAt: components['schemas']['Timestamp'];
      sessionId: components['schemas']['Uuid'];
      user: components['schemas']['User'];
    };
    BlindLevel: {
      bigBlind: components['schemas']['ChipAmount'];
      level: number;
      smallBlind: components['schemas']['ChipAmount'];
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
    /**
     * Format: int64
     * @description Integer amount of virtual chips (no monetary value).
     */
    ChipAmount: number;
    ChipMovementRequest: {
      /** Format: int64 */
      amount: number;
      note?: string;
      userId: components['schemas']['Uuid'];
    };
    CloseTableResult: {
      /** @description Players still seated (0 once CLOSED). */
      seated: number;
      /**
       * @description CLOSING while a hand finishes; seats are then cashed out.
       * @enum {string}
       */
      status: 'CLOSED' | 'CLOSING';
      tableId: components['schemas']['Uuid'];
    };
    Club: {
      createdAt: components['schemas']['Timestamp'];
      description: string | null;
      id: components['schemas']['Uuid'];
      /** @description Visible to AGENT and above only. */
      joinCode?: string;
      memberCount?: number;
      /**
       * @description Null when viewed through platform-admin oversight.
       * @enum {string|null}
       */
      myRole: 'OWNER' | 'ADMIN' | 'AGENT' | 'MEMBER' | null;
      name: string;
      ownerUserId: components['schemas']['Uuid'];
      status: components['schemas']['ClubStatus'];
    };
    ClubList: {
      items: components['schemas']['Club'][];
    };
    /** @enum {string} */
    ClubRole: 'OWNER' | 'ADMIN' | 'AGENT' | 'MEMBER';
    /** @enum {string} */
    ClubStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
    CreateClubRequest: {
      description?: string;
      name: string;
    };
    CreateInviteRequest: {
      /** @default 72 */
      expiresInHours: number;
      /** @default 1 */
      maxUses: number;
      /**
       * @default MEMBER
       * @enum {string}
       */
      role: 'MEMBER' | 'AGENT';
    };
    CreateTableRequest: {
      /** @default 20 */
      actionTimeoutSec: number;
      bigBlind: components['schemas']['ChipAmount'];
      buyInMax: components['schemas']['ChipAmount'];
      buyInMin: components['schemas']['ChipAmount'];
      /**
       * @description See GameType. Fixed for the table's lifetime.
       * @default NLHE
       * @enum {string}
       */
      gameType: 'NLHE' | 'PLO';
      /** @default 6 */
      maxSeats: number;
      name: string;
      smallBlind: components['schemas']['ChipAmount'];
    };
    CreateTournamentRequest: {
      /** @default 20 */
      actionTimeoutSec: number;
      /**
       * Format: int64
       * @description Level 1 big blind (at most a tenth of the starting stack).
       */
      bigBlind: number;
      /**
       * Format: int64
       * @description Club chips paid into the prize pool (0 = freeroll).
       */
      buyIn: number;
      /**
       * @default NLHE
       * @enum {string}
       */
      gameType: 'NLHE' | 'PLO';
      levelDurationSec: number;
      maxPlayers: number;
      /** @default 2 */
      minPlayers: number;
      name: string;
      /** @default 6 */
      seatsPerTable: number;
      /**
       * Format: int64
       * @description Level 1 small blind; later levels follow a standard progression.
       */
      smallBlind: number;
      /** Format: int64 */
      startingStack: number;
      startMode: components['schemas']['TournamentStartMode'];
      /**
       * Format: date-time
       * @description Required for SCHEDULED (in the future); not allowed for SIT_AND_GO.
       */
      startsAt?: string;
    };
    ErrorBody: {
      code: components['schemas']['ErrorCode'];
      details?: {
        [key: string]: unknown;
      };
      /** @description Human-readable summary (not for programmatic use). */
      message: string;
      requestId: string;
    };
    /**
     * @description Stable machine-readable error codes shared by HTTP and realtime APIs.
     *     Clients must branch on `code`, never on `message`.
     * @enum {string}
     */
    ErrorCode:
      | 'VALIDATION_FAILED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'INTERNAL'
      | 'SERVICE_UNAVAILABLE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'AUTH_REQUIRED'
      | 'AUTH_INVALID_CREDENTIALS'
      | 'AUTH_TOKEN_INVALID'
      | 'AUTH_TOKEN_EXPIRED'
      | 'AUTH_REFRESH_INVALID'
      | 'AUTH_REFRESH_REUSED'
      | 'AUTH_SESSION_REVOKED'
      | 'ACCOUNT_SUSPENDED'
      | 'EMAIL_TAKEN'
      | 'USERNAME_TAKEN'
      | 'FORBIDDEN'
      | 'CLUB_NOT_FOUND'
      | 'NOT_CLUB_MEMBER'
      | 'CLUB_BANNED'
      | 'ALREADY_CLUB_MEMBER'
      | 'INVITE_INVALID'
      | 'ROLE_CHANGE_NOT_ALLOWED'
      | 'INSUFFICIENT_CHIPS'
      | 'LEDGER_INVARIANT_VIOLATION'
      | 'TABLE_NOT_FOUND'
      | 'TABLE_CLOSED'
      | 'TABLE_FULL'
      | 'SEAT_TAKEN'
      | 'ALREADY_SEATED'
      | 'PLAYER_NOT_SEATED'
      | 'INVALID_BUY_IN'
      | 'NOT_YOUR_TURN'
      | 'ILLEGAL_ACTION'
      | 'INVALID_RAISE'
      | 'HAND_NOT_ACTIVE'
      | 'STALE_GAME_STATE'
      | 'ACTION_ALREADY_PROCESSED'
      | 'TABLE_UNAVAILABLE'
      | 'HAND_NOT_FOUND'
      | 'TOURNAMENT_NOT_FOUND'
      | 'TOURNAMENT_NOT_OPEN'
      | 'TOURNAMENT_FULL'
      | 'ALREADY_REGISTERED'
      | 'NOT_REGISTERED'
      | 'NOT_ENOUGH_PLAYERS';
    ErrorEnvelope: {
      error: components['schemas']['ErrorBody'];
    };
    /**
     * @description NLHE = No-Limit Texas Hold'em (2 hole cards). PLO = Pot-Limit Omaha
     *     (4 hole cards; a hand uses exactly two of them and three board cards;
     *     bets and raises are capped at the pot).
     * @enum {string}
     */
    GameType: 'NLHE' | 'PLO';
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
    HandDetail: components['schemas']['HandSummary'] & {
      buttonSeat: number;
      /** @description SHA-256 commitment to the shuffled deck (internal audit). */
      deckCommitment: string;
      /** @description Public action log of the hand (never contains unrevealed cards). */
      events: components['schemas']['HandEventRecord'][];
      /** @description The viewer's own hole cards; null for non-participants. */
      myHoleCards: components['schemas']['Card'][] | null;
      players: components['schemas']['HandParticipant'][];
      /** @enum {string} */
      viewerRole: 'PARTICIPANT' | 'CLUB_STAFF' | 'PLATFORM_ADMIN';
      voidReason: string | null;
    };
    HandEventRecord: {
      createdAt: components['schemas']['Timestamp'];
      event: components['schemas']['TableEventPayload'];
      /** Format: int64 */
      seq: number;
    };
    HandParticipant: {
      /** Format: int64 */
      contributed: number | null;
      /** Format: int64 */
      endingStack: number | null;
      folded: boolean | null;
      /** Format: int64 */
      net: number | null;
      seat: number;
      /** @description Cards revealed at showdown (public); null when not shown. */
      shownCards: components['schemas']['Card'][] | null;
      startingStack: components['schemas']['ChipAmount'];
      userId: components['schemas']['Uuid'];
      username: string;
      /** Format: int64 */
      won: number | null;
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
      gameType: components['schemas']['GameType'];
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
      tournament?: components['schemas']['TournamentTableInfo'];
    };
    /** @description No additionalProperties restriction because HandDetail extends it (allOf). */
    HandSummary: {
      bigBlind: components['schemas']['ChipAmount'];
      board: components['schemas']['Card'][];
      clubId: components['schemas']['Uuid'];
      clubName: string;
      endedAt: components['schemas']['Timestamp'];
      gameType: components['schemas']['GameType'];
      /** Format: int64 */
      handNo: number;
      id: components['schemas']['Uuid'];
      /**
       * Format: int64
       * @description The viewer's result; null when the viewer did not play or the hand was voided.
       */
      myNet: number | null;
      playerCount: number;
      pot: components['schemas']['ChipAmount'];
      smallBlind: components['schemas']['ChipAmount'];
      startedAt: components['schemas']['Timestamp'];
      /** @enum {string} */
      status: 'COMPLETED' | 'VOIDED';
      tableId: components['schemas']['Uuid'];
      tableName: string;
      /** Format: uuid */
      tournamentId: string | null;
    };
    HandSummaryPage: {
      items: components['schemas']['HandSummary'][];
      nextCursor: string | null;
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
    HealthStatus: {
      checks?: {
        [key: string]: string;
      };
      service: string;
      /** @enum {string} */
      status: 'ok' | 'unavailable' | 'draining';
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
    Invite: {
      clubId: components['schemas']['Uuid'];
      createdAt: components['schemas']['Timestamp'];
      expiresAt: components['schemas']['Timestamp'];
      id: components['schemas']['Uuid'];
      maxUses: number;
      /** Format: date-time */
      revokedAt: string | null;
      /** @enum {string} */
      role: 'MEMBER' | 'AGENT';
      /** @enum {string} */
      status: 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'REVOKED';
      useCount: number;
    };
    InviteCreated: {
      /** @description Plaintext invite code, returned only once. */
      code: string;
      invite: components['schemas']['Invite'];
    };
    InviteList: {
      items: components['schemas']['Invite'][];
    };
    JoinClubRequest: {
      /** @description Club join code (8 chars) or invite code (12 chars); case-insensitive. */
      code: string;
    };
    LeaveResult: {
      cashOut: components['schemas']['ChipAmount'];
      /** @enum {string} */
      status: 'LEFT' | 'LEAVING_AFTER_HAND';
      tableId: components['schemas']['Uuid'];
    };
    /** @enum {string} */
    LedgerAccountKind: 'CLUB_TREASURY' | 'MEMBER_WALLET' | 'TABLE_STACK' | 'TOURNAMENT_POOL';
    LedgerEntry: {
      accountId: components['schemas']['Uuid'];
      accountKind: components['schemas']['LedgerAccountKind'];
      amount: components['schemas']['ChipAmount'];
      balanceAfter: components['schemas']['ChipAmount'];
      ownerId: components['schemas']['Uuid'];
      ownerUsername: string | null;
      /** Format: uuid */
      tableId: string | null;
    };
    /** @enum {string} */
    LedgerKind:
      | 'CLUB_GRANT'
      | 'CLUB_DEDUCTION'
      | 'PROMOTIONAL_CREDIT'
      | 'ADMIN_ADJUSTMENT'
      | 'TABLE_BUY_IN'
      | 'TABLE_CASH_OUT'
      | 'HAND_SETTLEMENT'
      | 'REVERSAL'
      | 'TOURNAMENT_BUY_IN'
      | 'TOURNAMENT_REFUND'
      | 'TOURNAMENT_PAYOUT';
    LedgerSummary: {
      atTables: components['schemas']['ChipAmount'];
      clubId: components['schemas']['Uuid'];
      holders: number;
      inTournaments: components['schemas']['ChipAmount'];
      inWallets: components['schemas']['ChipAmount'];
      issued: components['schemas']['ChipAmount'];
    };
    LedgerTransaction: {
      /** @enum {string} */
      actorType: 'USER' | 'SYSTEM' | 'GAME_SERVICE';
      /** Format: uuid */
      actorUserId: string | null;
      actorUsername: string | null;
      createdAt: components['schemas']['Timestamp'];
      entries: components['schemas']['LedgerEntry'][];
      id: components['schemas']['Uuid'];
      kind: components['schemas']['LedgerKind'];
      metadata: {
        [key: string]: unknown;
      };
      referenceId: string | null;
      referenceType: string | null;
      /** Format: uuid */
      reversesTxId: string | null;
    };
    LedgerTransactionPage: {
      items: components['schemas']['LedgerTransaction'][];
      nextCursor: string | null;
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
       * @description BET/RAISE maximum "to" amount (all-in, or the pot limit in PLO).
       */
      maxTo?: number;
      /**
       * Format: int64
       * @description BET/RAISE minimum "to" amount.
       */
      minTo?: number;
    };
    LoginRequest: {
      deviceId?: string;
      /** @description Email or username */
      login: string;
      password: string;
    };
    Member: {
      joinedAt: components['schemas']['Timestamp'];
      role: components['schemas']['ClubRole'];
      status: components['schemas']['MemberStatus'];
      userId: components['schemas']['Uuid'];
      username: string;
    };
    MemberBalance: {
      tableBalance: components['schemas']['ChipAmount'];
      userId: components['schemas']['Uuid'];
      username: string;
      walletBalance: components['schemas']['ChipAmount'];
    };
    MemberBalancePage: {
      items: components['schemas']['MemberBalance'][];
      nextCursor: string | null;
    };
    MemberPage: {
      items: components['schemas']['Member'][];
      nextCursor: string | null;
    };
    /** @enum {string} */
    MemberStatus: 'ACTIVE' | 'BANNED' | 'LEFT';
    PlatformOverview: {
      clubs: {
        active: number;
        suspended: number;
        total: number;
      };
      generatedAt: components['schemas']['Timestamp'];
      hands: {
        completedLast24h: number;
        inProgress: number;
        voidedLast24h: number;
      };
      ledger: {
        /** @description Must always be 0; anything else pages the on-call (docs/runbooks). */
        invariantViolations: number;
      };
      risk: {
        highSeverityOpen: number;
        openEvents: number;
      };
      sessions: {
        active: number;
      };
      tables: {
        open: number;
        seatedPlayers: number;
      };
      users: {
        platformAdmins: number;
        suspended: number;
        total: number;
      };
    };
    /** @enum {string} */
    PlatformRole: 'USER' | 'PLATFORM_ADMIN';
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
      place?: number;
      /**
       * @description Tournaments: MOVED (balancing; see toTableId), ELIMINATED (with the
       *     finishing place) and FINISHED (the tournament ended; the winner's
       *     place is 1).
       * @enum {string}
       */
      reason: 'LEFT' | 'BUSTED' | 'TABLE_CLOSED' | 'MOVED' | 'ELIMINATED' | 'FINISHED';
      /** @description 0 for a tournament player redirected before taking a seat here (reason MOVED). */
      seat: number;
      /** Format: uuid */
      toTableId?: string;
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
    RefreshRequest: {
      refreshToken?: string;
    };
    RegisterRequest: {
      deviceId?: string;
      /** Format: email */
      email: string;
      password: string;
      username: string;
    };
    ReversalRequest: {
      note: string;
    };
    ReviewRiskEventRequest: {
      /** @enum {string} */
      disposition: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED';
      note: string;
    };
    RiskEvent: {
      /** Format: uuid */
      clubId: string | null;
      createdAt: components['schemas']['Timestamp'];
      /** @enum {string|null} */
      disposition: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED' | null;
      evidenceRefs: unknown[];
      featureValues: {
        [key: string]: unknown;
      };
      id: components['schemas']['Uuid'];
      /** Format: date-time */
      reviewedAt: string | null;
      /** Format: uuid */
      reviewedBy: string | null;
      reviewedByUsername: string | null;
      reviewNote: string | null;
      score: number;
      /** @enum {string} */
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
      /** Format: uuid */
      subjectUserId: string | null;
      subjectUsername: string | null;
      type: string;
    };
    RiskEventPage: {
      items: components['schemas']['RiskEvent'][];
      nextCursor: string | null;
    };
    SeatRequest: {
      buyIn: components['schemas']['ChipAmount'];
      /** @description Omit to take the first free seat. */
      seatNo?: number;
    };
    SeatResult: {
      seatNo: number;
      /** Format: int64 */
      seq: number;
      stack: components['schemas']['ChipAmount'];
      tableId: components['schemas']['Uuid'];
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
    Session: {
      createdAt: components['schemas']['Timestamp'];
      current: boolean;
      deviceId: string | null;
      expiresAt: components['schemas']['Timestamp'];
      id: components['schemas']['Uuid'];
      lastUsedAt: components['schemas']['Timestamp'];
      userAgent: string | null;
    };
    SessionList: {
      items: components['schemas']['Session'][];
    };
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
    Table: {
      actionTimeoutSec: number;
      bigBlind: components['schemas']['ChipAmount'];
      buyInMax: components['schemas']['ChipAmount'];
      buyInMin: components['schemas']['ChipAmount'];
      clubId: components['schemas']['Uuid'];
      createdAt: components['schemas']['Timestamp'];
      createdBy: components['schemas']['Uuid'];
      gameType: components['schemas']['GameType'];
      id: components['schemas']['Uuid'];
      maxSeats: number;
      name: string;
      seatedCount: number;
      smallBlind: components['schemas']['ChipAmount'];
      /** @enum {string} */
      status: 'OPEN' | 'CLOSED';
      /**
       * Format: uuid
       * @description Set for a tournament's tables (seats are assigned by the tournament).
       */
      tournamentId: string | null;
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
    TableDetail: components['schemas']['Table'] & {
      seats: components['schemas']['TableSeat'][];
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
      gameType: components['schemas']['GameType'];
      maxSeats: number;
      name: string;
      /** Format: int64 */
      smallBlind: number;
      /** @enum {string} */
      status: 'OPEN' | 'CLOSED';
      tournament?: components['schemas']['TournamentTableInfo'];
    };
    TableList: {
      items: components['schemas']['Table'][];
    };
    TableSeat: {
      seatNo: number;
      sittingOut: boolean;
      stack: components['schemas']['ChipAmount'];
      userId: components['schemas']['Uuid'];
      username: string;
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
    /**
     * Format: date-time
     * @description UTC RFC 3339 timestamp
     */
    Timestamp: string;
    /** @description No additionalProperties restriction because TournamentDetail extends it (allOf). */
    Tournament: {
      actionTimeoutSec: number;
      buyIn: components['schemas']['ChipAmount'];
      clubId: components['schemas']['Uuid'];
      createdAt: components['schemas']['Timestamp'];
      /** Format: date-time */
      finishedAt: string | null;
      gameType: components['schemas']['GameType'];
      id: components['schemas']['Uuid'];
      levelDurationSec: number;
      maxPlayers: number;
      minPlayers: number;
      name: string;
      prizePool: components['schemas']['ChipAmount'];
      /** @description Whether the viewer holds an active registration / entry. */
      registered: boolean;
      /** @description Active registrations (entrants once started). */
      registeredCount: number;
      seatsPerTable: number;
      /** Format: date-time */
      startedAt: string | null;
      /**
       * Format: int64
       * @description Tournament chips each player starts with (not club chips).
       */
      startingStack: number;
      startMode: components['schemas']['TournamentStartMode'];
      /** Format: date-time */
      startsAt: string | null;
      status: components['schemas']['TournamentStatus'];
    };
    TournamentDetail: components['schemas']['Tournament'] & {
      /** @description The level in effect for new hands (null before the start and after the end). */
      currentLevel: {
        bigBlind: components['schemas']['ChipAmount'];
        level: number;
        smallBlind: components['schemas']['ChipAmount'];
      } | null;
      entrants: components['schemas']['TournamentEntrant'][];
      /** Format: date-time */
      levelEndsAt: string | null;
      /** @description The first levels of the blind schedule (later levels keep doubling). */
      levels: components['schemas']['BlindLevel'][];
      /** Format: uuid */
      myTableId: string | null;
      /** @description Prizes by place (projected from current registrations before the start). */
      payouts: components['schemas']['TournamentPayout'][];
      playersLeft: number;
    };
    TournamentEntrant: {
      /** @description Finishing place (null while still playing); tied players share a place. */
      place: number | null;
      prize: components['schemas']['ChipAmount'];
      /**
       * Format: int64
       * @description Tournament chips at the last completed hand (null when out or moving).
       */
      stack: number | null;
      /**
       * Format: uuid
       * @description Current (or destination, while moving) table.
       */
      tableId: string | null;
      userId: components['schemas']['Uuid'];
      username: string;
    };
    TournamentList: {
      items: components['schemas']['Tournament'][];
    };
    TournamentPayout: {
      amount: components['schemas']['ChipAmount'];
      place: number;
    };
    /**
     * @description SIT_AND_GO starts when maxPlayers registered; SCHEDULED at startsAt (cancelled and refunded if fewer than minPlayers).
     * @enum {string}
     */
    TournamentStartMode: 'SIT_AND_GO' | 'SCHEDULED';
    /** @enum {string} */
    TournamentStatus: 'REGISTERING' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
    /** @description Tournament context of a tournament table (level and blinds in effect for new hands). */
    TournamentTableInfo: {
      /** Format: int64 */
      bigBlind: number;
      level: number;
      /** Format: date-time */
      levelEndsAt: string;
      name: string;
      /** Format: int64 */
      nextBigBlind: number;
      /** Format: int64 */
      nextSmallBlind: number;
      /** Format: int64 */
      smallBlind: number;
      /** @enum {string} */
      status: 'RUNNING' | 'FINISHED';
      tableNo: number;
      /** Format: uuid */
      tournamentId: string;
    };
    TransferOwnershipRequest: {
      userId: components['schemas']['Uuid'];
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
    UpdateAccountStatusRequest: {
      /** @description Recorded in the audit log. */
      reason: string;
      /** @enum {string} */
      status: 'ACTIVE' | 'SUSPENDED';
    };
    UpdateClubRequest: {
      description?: string | null;
      name?: string;
    };
    UpdateMemberRequest: {
      /** @enum {string} */
      role?: 'ADMIN' | 'AGENT' | 'MEMBER';
      /** @enum {string} */
      status?: 'ACTIVE' | 'BANNED';
    };
    User: {
      createdAt: components['schemas']['Timestamp'];
      /** Format: email */
      email: string;
      id: components['schemas']['Uuid'];
      platformRole: components['schemas']['PlatformRole'];
      status: components['schemas']['UserStatus'];
      username: string;
    };
    /** @enum {string} */
    UserStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    /** Format: uuid */
    Uuid: string;
    Wallet: {
      balance: components['schemas']['ChipAmount'];
      clubId: components['schemas']['Uuid'];
      userId: components['schemas']['Uuid'];
    };
    WalletEntry: {
      amount: components['schemas']['ChipAmount'];
      balanceAfter: components['schemas']['ChipAmount'];
      createdAt: components['schemas']['Timestamp'];
      entryId: components['schemas']['Uuid'];
      kind: components['schemas']['LedgerKind'];
      referenceId: string | null;
      referenceType: string | null;
      txId: components['schemas']['Uuid'];
    };
    WalletEntryPage: {
      items: components['schemas']['WalletEntry'][];
      nextCursor: string | null;
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
  responses: {
    /** @description Machine-readable error */
    Error: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
  };
  parameters: {
    /**
     * @description `cookie` makes the API deliver the refresh token in an HttpOnly
     *     SameSite=Strict cookie (`kof_rt`, path `/v1/auth`) instead of the body.
     */
    AuthTransport: 'cookie' | 'body';
    ClubId: components['schemas']['Uuid'];
    /** @description Opaque cursor from a previous page's `nextCursor`. */
    Cursor: string;
    HandId: components['schemas']['Uuid'];
    /** @description Unique key making a retried state-changing request a no-op. */
    IdempotencyKey: string;
    Limit: number;
    /** @description Client-supplied correlation id (echoed back). */
    RequestId: string;
    TableId: components['schemas']['Uuid'];
    TournamentId: components['schemas']['Uuid'];
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  getHealthLive: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is serving HTTP */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthStatus'];
        };
      };
    };
  };
  getHealthReady: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description All dependencies reachable */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthStatus'];
        };
      };
      /** @description A dependency is unavailable or the service is draining */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthStatus'];
        };
      };
    };
  };
  adminAuditLog: {
    parameters: {
      query?: {
        action?: string;
        actorUserId?: components['schemas']['Uuid'];
        clubId?: components['schemas']['Uuid'];
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditPage'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  adminSearchClubs: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        /** @description Case-insensitive prefix (username/email for users, name for clubs). */
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminClubPage'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  adminSetClubStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateAccountStatusRequest'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminClub'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  adminOverview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PlatformOverview'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  adminRiskEvents: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        status?: 'OPEN' | 'REVIEWED';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RiskEventPage'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  adminReviewRiskEvent: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        eventId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReviewRiskEventRequest'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RiskEvent'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  adminSearchUsers: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        /** @description Case-insensitive prefix (username/email for users, name for clubs). */
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminUserPage'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  adminSetUserStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        userId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateAccountStatusRequest'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminUser'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  login: {
    parameters: {
      query?: never;
      header?: {
        /**
         * @description `cookie` makes the API deliver the refresh token in an HttpOnly
         *     SameSite=Strict cookie (`kof_rt`, path `/v1/auth`) instead of the body.
         */
        'X-Auth-Transport'?: components['parameters']['AuthTransport'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginRequest'];
      };
    };
    responses: {
      /** @description Logged in */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResult'];
        };
      };
      401: components['responses']['Error'];
      403: components['responses']['Error'];
      429: components['responses']['Error'];
    };
  };
  logout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      401: components['responses']['Error'];
    };
  };
  refresh: {
    parameters: {
      query?: never;
      header?: {
        /**
         * @description `cookie` makes the API deliver the refresh token in an HttpOnly
         *     SameSite=Strict cookie (`kof_rt`, path `/v1/auth`) instead of the body.
         */
        'X-Auth-Transport'?: components['parameters']['AuthTransport'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': components['schemas']['RefreshRequest'];
      };
    };
    responses: {
      /** @description New token pair */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResult'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  register: {
    parameters: {
      query?: never;
      header?: {
        /**
         * @description `cookie` makes the API deliver the refresh token in an HttpOnly
         *     SameSite=Strict cookie (`kof_rt`, path `/v1/auth`) instead of the body.
         */
        'X-Auth-Transport'?: components['parameters']['AuthTransport'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterRequest'];
      };
    };
    responses: {
      /** @description Account created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResult'];
        };
      };
      400: components['responses']['Error'];
      409: components['responses']['Error'];
      429: components['responses']['Error'];
    };
  };
  listMyClubs: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Clubs */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ClubList'];
        };
      };
    };
  };
  createClub: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateClubRequest'];
      };
    };
    responses: {
      /** @description Club created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      400: components['responses']['Error'];
    };
  };
  getClub: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Club */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  updateClub: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateClubRequest'];
      };
    };
    responses: {
      /** @description Updated club */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  listClubAuditLog: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of audit records */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditPage'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  deductChips: {
    parameters: {
      query?: never;
      header: {
        /** @description Required for chip movements; retries with the same key never move chips twice. */
        'Idempotency-Key': string;
      };
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ChipMovementRequest'];
      };
    };
    responses: {
      /** @description Posted ledger transaction */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LedgerTransaction'];
        };
      };
      422: components['responses']['Error'];
    };
  };
  grantChips: {
    parameters: {
      query?: never;
      header: {
        /** @description Required for chip movements; retries with the same key never move chips twice. */
        'Idempotency-Key': string;
      };
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ChipMovementRequest'];
      };
    };
    responses: {
      /** @description Posted ledger transaction */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LedgerTransaction'];
        };
      };
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  listClubHands: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        tableId?: components['schemas']['Uuid'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of hand summaries */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HandSummaryPage'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  listClubInvites: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Invites */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InviteList'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  createClubInvite: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateInviteRequest'];
      };
    };
    responses: {
      /** @description Invite created; the code is only returned once */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InviteCreated'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  revokeClubInvite: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
        inviteId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['Error'];
    };
  };
  joinClub: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['JoinClubRequest'];
      };
    };
    responses: {
      /** @description Joined */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  rotateClubJoinCode: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Club with the new join code */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  leaveClub: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Left */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      403: components['responses']['Error'];
    };
  };
  listMemberBalances: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of balances */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MemberBalancePage'];
        };
      };
    };
  };
  getLedgerSummary: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Summary */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LedgerSummary'];
        };
      };
    };
  };
  listLedgerTransactions: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of transactions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LedgerTransactionPage'];
        };
      };
    };
  };
  reverseLedgerTransaction: {
    parameters: {
      query?: never;
      header: {
        /** @description Required for chip movements; retries with the same key never move chips twice. */
        'Idempotency-Key': string;
      };
      path: {
        clubId: components['parameters']['ClubId'];
        txId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReversalRequest'];
      };
    };
    responses: {
      /** @description Posted reversal */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LedgerTransaction'];
        };
      };
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  listClubMembers: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        /** @description Filter by status (staff only; members always see ACTIVE). */
        status?: components['schemas']['MemberStatus'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of members */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MemberPage'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  updateClubMember: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
        userId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateMemberRequest'];
      };
    };
    responses: {
      /** @description Updated member */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Member'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  listClubTables: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tables */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TableList'];
        };
      };
    };
  };
  createTable: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateTableRequest'];
      };
    };
    responses: {
      /** @description Table created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TableDetail'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  listClubTournaments: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tournaments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentList'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  createTournament: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateTournamentRequest'];
      };
    };
    responses: {
      /** @description Tournament created (registration open) */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
    };
  };
  transferClubOwnership: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TransferOwnershipRequest'];
      };
    };
    responses: {
      /** @description Club after the transfer (viewed by the previous owner) */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      400: components['responses']['Error'];
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  getMyWallet: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Wallet */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Wallet'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  listMyWalletEntries: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path: {
        clubId: components['parameters']['ClubId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of entries */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WalletEntryPage'];
        };
      };
    };
  };
  joinClubByCode: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['JoinClubRequest'];
      };
    };
    responses: {
      /** @description Joined */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Club'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  getHand: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        handId: components['parameters']['HandId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Hand */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HandDetail'];
        };
      };
      404: components['responses']['Error'];
    };
  };
  getMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['User'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  listMyHands: {
    parameters: {
      query?: {
        /** @description Opaque cursor from a previous page's `nextCursor`. */
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page of hand summaries */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HandSummaryPage'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  listMySessions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionList'];
        };
      };
      401: components['responses']['Error'];
    };
  };
  revokeMySession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        sessionId: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['Error'];
    };
  };
  getTable: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Table */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TableDetail'];
        };
      };
      404: components['responses']['Error'];
    };
  };
  closeTable: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Closure applied */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CloseTableResult'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      503: components['responses']['Error'];
    };
  };
  leaveTable: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Left or leaving after the hand */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LeaveResult'];
        };
      };
      409: components['responses']['Error'];
    };
  };
  takeSeat: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SeatRequest'];
      };
    };
    responses: {
      /** @description Seated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SeatResult'];
        };
      };
      400: components['responses']['Error'];
      409: components['responses']['Error'];
      422: components['responses']['Error'];
    };
  };
  getTableState: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tableId: components['parameters']['TableId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Snapshot */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TableSnapshot'];
        };
      };
      403: components['responses']['Error'];
    };
  };
  getTournament: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tournament */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
    };
  };
  cancelTournament: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Cancelled */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  registerForTournament: {
    parameters: {
      query?: never;
      header?: {
        /** @description Unique key making a retried state-changing request a no-op. */
        'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
      };
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Registered */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      403: components['responses']['Error'];
      404: components['responses']['Error'];
      409: components['responses']['Error'];
      422: components['responses']['Error'];
    };
  };
  startTournament: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Start requested */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      403: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
  unregisterFromTournament: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tournamentId: components['parameters']['TournamentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Unregistered */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TournamentDetail'];
        };
      };
      404: components['responses']['Error'];
      409: components['responses']['Error'];
    };
  };
}
