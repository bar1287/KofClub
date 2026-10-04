import type { ErrorCode } from '@kofclub/contracts';

/** Default HTTP status for each error code. */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  INVALID_BUY_IN: 400,
  INVALID_RAISE: 400,
  ILLEGAL_ACTION: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_REFRESH_INVALID: 401,
  AUTH_REFRESH_REUSED: 401,
  AUTH_SESSION_REVOKED: 401,
  ACCOUNT_SUSPENDED: 403,
  MFA_INVALID: 401,
  MFA_REQUIRED: 403,
  MFA_ALREADY_ENABLED: 409,
  MFA_NOT_ENABLED: 409,
  FORBIDDEN: 403,
  NOT_CLUB_MEMBER: 403,
  CLUB_BANNED: 403,
  ROLE_CHANGE_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CLUB_NOT_FOUND: 404,
  TABLE_NOT_FOUND: 404,
  HAND_NOT_FOUND: 404,
  INVITE_INVALID: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  ALREADY_CLUB_MEMBER: 409,
  IDEMPOTENCY_CONFLICT: 409,
  TABLE_FULL: 409,
  TABLE_CLOSED: 409,
  SEAT_TAKEN: 409,
  ALREADY_SEATED: 409,
  PLAYER_NOT_SEATED: 409,
  NOT_YOUR_TURN: 409,
  HAND_NOT_ACTIVE: 409,
  STALE_GAME_STATE: 409,
  ACTION_ALREADY_PROCESSED: 409,
  TOURNAMENT_NOT_FOUND: 404,
  TOURNAMENT_NOT_OPEN: 409,
  TOURNAMENT_FULL: 409,
  ALREADY_REGISTERED: 409,
  NOT_REGISTERED: 409,
  NOT_ENOUGH_PLAYERS: 409,
  INSUFFICIENT_CHIPS: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  LEDGER_INVARIANT_VIOLATION: 500,
  SERVICE_UNAVAILABLE: 503,
  TABLE_UNAVAILABLE: 503,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 400;
}

/**
 * Domain/application error carrying a stable machine-readable code.
 * Thrown by services; translated to the error envelope by AppErrorFilter.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    status?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? statusForCode(code);
  }
}
