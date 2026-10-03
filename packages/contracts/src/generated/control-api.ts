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
    patch?: never;
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
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
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
      | 'TOURNAMENT_NOT_OPEN';
    ErrorEnvelope: {
      error: components['schemas']['ErrorBody'];
    };
    HealthStatus: {
      checks?: {
        [key: string]: string;
      };
      service: string;
      /** @enum {string} */
      status: 'ok' | 'unavailable' | 'draining';
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
    /** @enum {string} */
    LedgerAccountKind: 'CLUB_TREASURY' | 'MEMBER_WALLET' | 'TABLE_STACK';
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
      | 'REVERSAL';
    LedgerSummary: {
      atTables: components['schemas']['ChipAmount'];
      clubId: components['schemas']['Uuid'];
      holders: number;
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
    /** @enum {string} */
    PlatformRole: 'USER' | 'PLATFORM_ADMIN';
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
    /**
     * Format: date-time
     * @description UTC RFC 3339 timestamp
     */
    Timestamp: string;
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
    /** @description Unique key making a retried state-changing request a no-op. */
    IdempotencyKey: string;
    Limit: number;
    /** @description Client-supplied correlation id (echoed back). */
    RequestId: string;
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
}
