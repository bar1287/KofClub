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
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /**
     * Format: int64
     * @description Integer amount of virtual chips (no monetary value).
     */
    ChipAmount: number;
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
    /**
     * Format: date-time
     * @description UTC RFC 3339 timestamp
     */
    Timestamp: string;
    /** Format: uuid */
    Uuid: string;
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
    /** @description Unique key making a retried state-changing request a no-op. */
    IdempotencyKey: string;
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
}
