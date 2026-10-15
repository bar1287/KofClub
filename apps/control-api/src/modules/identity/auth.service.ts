import { Inject, Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../../common/auth/token.service';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { RequestContext } from '../../common/request-context';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Database, isUniqueViolation } from '../../infra/database/database';
import { MetricsService } from '../../metrics/metrics.service';
import { RiskService } from '../risk/risk.service';
import {
  InitDataError,
  validateInitData,
  type InitData,
  type TelegramUser,
} from '../telegram/init-data';
import type { LoginInput, RegisterInput, TelegramLoginInput } from './identity.schemas';
import { MfaService } from './mfa/mfa.service';
import { PasswordService } from './password.service';
import { SessionRevocationPublisher } from './session-revocation.publisher';
import { SessionRow, SessionsRepository } from './sessions.repository';
import { TelegramAccountRow, TelegramAccountsRepository } from './telegram-accounts.repository';
import { UserRow, UsersRepository } from './users.repository';

export interface UserDto {
  id: string;
  email: string | null;
  username: string;
  status: UserRow['status'];
  platformRole: UserRow['platformRole'];
  createdAt: string;
  hasPassword: boolean;
  telegram: { username: string | null; firstName: string | null; linkedAt: string } | null;
}

export interface AuthResult {
  user: UserDto;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionDto {
  id: string;
  deviceId: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export function toUserDto(u: UserRow, telegram: TelegramAccountRow | null): UserDto {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    status: u.status,
    platformRole: u.platformRole,
    createdAt: u.createdAt.toISOString(),
    hasPassword: u.passwordHash !== null,
    telegram: telegram
      ? {
          username: telegram.telegramUsername,
          firstName: telegram.firstName,
          linkedAt: telegram.linkedAt.toISOString(),
        }
      : null,
  };
}

/** Usernames to try for a new Telegram account, best first. */
export function telegramUsernameCandidates(u: TelegramUser): string[] {
  const clean = (s: string | null) => (s ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
  const out: string[] = [];
  const handle = clean(u.username);
  if (handle.length >= 3) out.push(handle);
  const first = clean(u.firstName);
  if (first.length >= 3) out.push(`${first.slice(0, 18)}_${String(u.id).slice(-4)}`);
  out.push(`tg_${u.id}`.slice(0, 24));
  return out;
}

const REFRESH_PREFIX = 'rt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly telegramAccounts: TelegramAccountsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly revocations: SessionRevocationPublisher,
    private readonly risk: RiskService,
    private readonly mfa: MfaService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput, ctx: RequestContext): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(input.password);
    const refreshToken = randomToken(REFRESH_PREFIX);
    try {
      const { user, session } = await this.db.tx(async (q) => {
        const user = await this.users.insert(q, {
          id: uuidv7(),
          email: input.email,
          username: input.username,
          passwordHash,
        });
        const session = await this.sessions.insert(
          q,
          this.newSession(user.id, refreshToken, input.deviceId, ctx),
        );
        return { user, session };
      });
      this.securityEvent('register', { userId: user.id });
      return this.authResult(user, session, refreshToken);
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key'))
        throw new AppError('EMAIL_TAKEN', 'Email is already registered');
      if (isUniqueViolation(err, 'users_username_key'))
        throw new AppError('USERNAME_TAKEN', 'Username is taken');
      throw err;
    }
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<AuthResult> {
    const user = await this.users.findByLogin(input.login);
    // Accounts created through Telegram have no password to sign in with.
    if (!user?.passwordHash) {
      await this.passwords.verifyAgainstDummy(input.password);
      this.securityEvent('login_failed', { reason: 'unknown_login' });
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid login or password');
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      this.securityEvent('login_failed', { userId: user.id, reason: 'bad_password' });
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid login or password');
    }
    if (user.status !== 'ACTIVE') {
      this.securityEvent('login_blocked', { userId: user.id, status: user.status });
      throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active');
    }
    // Second factor (ADR-017): only after the password was verified.
    let mfa: boolean;
    try {
      mfa = await this.mfa.verifyLogin(user, input.mfaCode, ctx);
    } catch (err) {
      if (err instanceof AppError && err.code === 'MFA_INVALID') {
        this.securityEvent('login_failed', { userId: user.id, reason: 'bad_mfa_code' });
      }
      throw err;
    }
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await this.passwords.hash(input.password));
    }

    const deviceId = input.deviceId ?? null;
    const history = await this.sessions.hasPriorSessionFrom(user.id, deviceId, ctx.ipHash);
    const refreshToken = randomToken(REFRESH_PREFIX);
    const session = await this.sessions.insert(this.db, {
      ...this.newSession(user.id, refreshToken, input.deviceId, ctx),
      mfa,
    });
    if (history.anyPrior && !history.known) {
      // Suspicious-login signal: new device and new network for this account.
      await this.risk.record({
        subjectUserId: user.id,
        type: 'NEW_DEVICE_LOGIN',
        severity: 'LOW',
        score: 10,
        featureValues: { deviceIdPresent: deviceId !== null },
        evidenceRefs: [`session:${session.id}`],
      });
      this.securityEvent('new_device_login', { userId: user.id, sessionId: session.id });
    }
    this.securityEvent('login_succeeded', { userId: user.id, sessionId: session.id });
    return this.authResult(user, session, refreshToken);
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated token revokes
   * the whole session (token theft/replay detection).
   */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<AuthResult> {
    const presentedHash = sha256(refreshToken);
    const newToken = randomToken(REFRESH_PREFIX);

    const outcome = await this.db.tx(async (q) => {
      const session = await this.sessions.findByRefreshHash(q, presentedHash);
      if (!session) {
        const reusedSessionId = await this.sessions.findSessionIdByRetiredToken(q, presentedHash);
        if (reusedSessionId) {
          await this.sessions.revoke(q, reusedSessionId, 'REFRESH_REUSE');
          return { kind: 'reused' as const, sessionId: reusedSessionId };
        }
        return { kind: 'invalid' as const };
      }
      if (session.revokedAt) return { kind: 'revoked' as const };
      if (session.expiresAt.getTime() <= Date.now()) return { kind: 'invalid' as const };
      const user = await this.users.findById(session.userId, q);
      if (!user || user.status !== 'ACTIVE') return { kind: 'suspended' as const };
      const rotated = await this.sessions.rotate(
        q,
        session.id,
        presentedHash,
        sha256(newToken),
        ctx.ipHash,
      );
      if (!rotated) return { kind: 'invalid' as const };
      return { kind: 'ok' as const, session, user };
    });

    switch (outcome.kind) {
      case 'ok':
        return this.authResult(outcome.user, outcome.session, newToken);
      case 'reused': {
        const reusedSession = await this.sessions.findById(outcome.sessionId);
        await this.revocations.publish([outcome.sessionId]);
        this.securityEvent('refresh_token_reuse', { sessionId: outcome.sessionId });
        await this.risk.record({
          subjectUserId: reusedSession?.userId ?? null,
          type: 'REFRESH_TOKEN_REUSE',
          severity: 'MEDIUM',
          score: 50,
          evidenceRefs: [`session:${outcome.sessionId}`],
        });
        throw new AppError('AUTH_REFRESH_REUSED', 'Refresh token reuse detected; session revoked');
      }
      case 'revoked':
        throw new AppError('AUTH_SESSION_REVOKED', 'Session has been revoked');
      case 'suspended':
        throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active');
      default:
        throw new AppError('AUTH_REFRESH_INVALID', 'Invalid or expired refresh token');
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(this.db, sessionId, 'LOGOUT');
    await this.revocations.publish([sessionId]);
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'User no longer exists');
    return toUserDto(user, await this.telegramAccounts.findByUser(userId));
  }

  /**
   * Signs in from the Telegram Mini App (ADR-018). A Telegram account that
   * is not linked yet needs `create` to get a new Telegram-only account;
   * otherwise TELEGRAM_NOT_LINKED lets the client offer linking instead.
   */
  async loginWithTelegram(input: TelegramLoginInput, ctx: RequestContext): Promise<AuthResult> {
    const tg = this.telegramInitData(input.initData);
    const account = await this.telegramAccounts.findByTelegramId(tg.user.id);
    let user = account ? await this.users.findById(account.userId) : null;
    if (user) {
      await this.telegramAccounts.touch(tg.user.id, tg.user.username, tg.user.firstName);
    } else if (input.create) {
      user = await this.createTelegramUser(tg.user);
    } else {
      throw new AppError(
        'TELEGRAM_NOT_LINKED',
        'This Telegram account has no KofClub account yet',
        {
          firstName: tg.user.firstName,
          telegramUsername: tg.user.username,
        },
      );
    }
    if (user.status !== 'ACTIVE') {
      this.securityEvent('login_blocked', { userId: user.id, status: user.status });
      throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active');
    }
    const mfa = await this.mfa.verifyLogin(user, input.mfaCode, ctx);
    const refreshToken = randomToken(REFRESH_PREFIX);
    const session = await this.sessions.insert(this.db, {
      ...this.newSession(user.id, refreshToken, input.deviceId, ctx),
      mfa,
    });
    this.securityEvent('login_succeeded', {
      userId: user.id,
      sessionId: session.id,
      method: 'telegram',
    });
    return this.authResult(user, session, refreshToken);
  }

  /** Links the open Mini App's Telegram account to a signed-in user. */
  async linkTelegram(userId: string, initData: string): Promise<UserDto> {
    const tg = this.telegramInitData(initData);
    const existing = await this.telegramAccounts.findByTelegramId(tg.user.id);
    if (existing?.userId === userId) return this.me(userId);
    if (existing) {
      throw new AppError(
        'TELEGRAM_ALREADY_LINKED',
        'This Telegram account belongs to another account',
      );
    }
    if (await this.telegramAccounts.findByUser(userId)) {
      throw new AppError(
        'TELEGRAM_ALREADY_LINKED',
        'Your account is linked to another Telegram account',
      );
    }
    try {
      await this.telegramAccounts.insert(this.db, {
        userId,
        telegramUserId: tg.user.id,
        username: tg.user.username,
        firstName: tg.user.firstName,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('TELEGRAM_ALREADY_LINKED', 'This Telegram account is already linked');
      }
      throw err;
    }
    this.securityEvent('telegram_linked', { userId });
    return this.me(userId);
  }

  /** Unlinks Telegram; an account without a password would lose access. */
  async unlinkTelegram(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'User no longer exists');
    if (!user.passwordHash) {
      throw new AppError(
        'CONFLICT',
        'This account signs in with Telegram only and cannot unlink it',
      );
    }
    if (!(await this.telegramAccounts.delete(this.db, userId))) {
      throw new AppError('NOT_FOUND', 'No Telegram account is linked');
    }
    this.securityEvent('telegram_unlinked', { userId });
  }

  private telegramInitData(raw: string): InitData {
    const token = this.config.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new AppError('TELEGRAM_NOT_CONFIGURED', 'Telegram sign-in is not available here');
    }
    try {
      return validateInitData(raw, token, this.config.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS);
    } catch (err) {
      if (!(err instanceof InitDataError)) throw err;
      this.securityEvent('telegram_auth_failed', { reason: err.problem });
      throw new AppError(
        'TELEGRAM_AUTH_INVALID',
        err.problem === 'expired'
          ? 'The Telegram sign-in expired; reopen the app from Telegram'
          : 'The Telegram sign-in could not be verified',
      );
    }
  }

  /** A new account that signs in with Telegram only (no email or password). */
  private async createTelegramUser(tg: TelegramUser): Promise<UserRow> {
    const candidates = telegramUsernameCandidates(tg);
    for (let attempt = 0; attempt < candidates.length + 3; attempt++) {
      const username =
        candidates[attempt] ??
        `player_${randomToken('x')
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(-8)}`;
      if (attempt < candidates.length && (await this.users.usernameTaken(username))) continue;
      try {
        const user = await this.db.tx(async (q) => {
          const created = await this.users.insert(q, {
            id: uuidv7(),
            email: null,
            username,
            passwordHash: null,
          });
          await this.telegramAccounts.insert(q, {
            userId: created.id,
            telegramUserId: tg.id,
            username: tg.username,
            firstName: tg.firstName,
          });
          return created;
        });
        this.securityEvent('register', { userId: user.id, method: 'telegram' });
        return user;
      } catch (err) {
        if (isUniqueViolation(err, 'users_username_key')) continue;
        if (isUniqueViolation(err, 'telegram_accounts_telegram_user_key')) {
          // Created concurrently (two taps): sign in to that account.
          const account = await this.telegramAccounts.findByTelegramId(tg.id);
          const user = account ? await this.users.findById(account.userId) : null;
          if (user) return user;
        }
        throw err;
      }
    }
    throw new AppError('CONFLICT', 'Could not choose a username; try again');
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const rows = await this.sessions.listActive(userId);
    return rows.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    // Do not reveal other users' session ids.
    if (!session || session.userId !== userId) throw new AppError('NOT_FOUND', 'Session not found');
    await this.sessions.revoke(this.db, sessionId, 'USER_REVOKED');
    await this.revocations.publish([sessionId]);
  }

  private newSession(
    userId: string,
    refreshToken: string,
    deviceId: string | undefined,
    ctx: RequestContext,
  ) {
    return {
      id: uuidv7(),
      userId,
      refreshHash: sha256(refreshToken),
      deviceId: deviceId ?? null,
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    };
  }

  private async authResult(
    user: UserRow,
    session: SessionRow,
    refreshToken: string,
  ): Promise<AuthResult> {
    const access = await this.tokens.issueAccessToken({
      userId: user.id,
      sessionId: session.id,
      platformRole: user.platformRole,
    });
    return {
      user: toUserDto(user, await this.telegramAccounts.findByUser(user.id)),
      sessionId: session.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }

  private securityEvent(type: string, fields: Record<string, unknown>): void {
    this.metrics.securityEvents.inc({ type });
    this.logger.log({ securityEvent: type, ...fields }, 'security_event');
  }
}
