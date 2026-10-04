import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { randomCode, sha256 } from '../../../common/crypto';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext, RequestContext } from '../../../common/request-context';
import { SecretBox } from '../../../common/secret-box';
import { APP_CONFIG, AppConfig } from '../../../config/config';
import { Database, Queryable } from '../../../infra/database/database';
import { MetricsService } from '../../../metrics/metrics.service';
import { AuditService } from '../../audit/audit.service';
import { SessionsRepository } from '../sessions.repository';
import { UserRow, UsersRepository } from '../users.repository';
import { MfaRepository, MfaRow } from './mfa.repository';
import { base32Encode, otpauthUri, verifyTotp } from './totp';

const ISSUER = 'KofClub';
const SECRET_BYTES = 20;
const RECOVERY_CODES = 10;
const RECOVERY_CODE_LENGTH = 10;

export interface MfaStatusDto {
  enabled: boolean;
  pending: boolean;
  recoveryCodesLeft: number;
  sessionVerified: boolean;
}

export interface TotpEnrollmentDto {
  secret: string;
  otpauthUri: string;
}

/** Normalizes user input: "abcde-fghjk " -> "ABCDEFGHJK". */
const normalize = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

/**
 * Two-factor authentication with TOTP and recovery codes (ADR-017). Secrets
 * are encrypted at rest (user id as associated data); codes are never logged.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly db: Database,
    private readonly repo: MfaRepository,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = new SecretBox(config.MFA_ENCRYPTION_KEY_B64);
  }

  async status(auth: AuthContext): Promise<MfaStatusDto> {
    const row = await this.repo.find(auth.userId);
    const enabled = !!row?.enabledAt;
    return {
      enabled,
      pending: !!row && !enabled,
      recoveryCodesLeft: enabled ? await this.repo.recoveryCodesLeft(auth.userId) : 0,
      sessionVerified: auth.mfa,
    };
  }

  async enrolled(userId: string): Promise<boolean> {
    return !!(await this.repo.find(userId))?.enabledAt;
  }

  async startEnrollment(auth: AuthContext): Promise<TotpEnrollmentDto> {
    const user = await this.users.findById(auth.userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'User no longer exists');
    const secret = randomBytes(SECRET_BYTES);
    if (!(await this.repo.savePending(user.id, this.box.seal(secret, user.id)))) {
      throw new AppError('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
    }
    const encoded = base32Encode(secret);
    secret.fill(0);
    return { secret: encoded, otpauthUri: otpauthUri(ISSUER, user.username, encoded) };
  }

  /** Activates the pending secret; returns recovery codes (shown once). */
  async confirm(
    auth: AuthContext,
    code: string,
    ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const codes = Array.from({ length: RECOVERY_CODES }, () => randomCode(RECOVERY_CODE_LENGTH));
    await this.db.tx(async (q) => {
      const row = await this.repo.find(auth.userId, q, true);
      if (!row) throw new AppError('MFA_NOT_ENABLED', 'Start enrollment first');
      if (row.enabledAt) {
        throw new AppError('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on');
      }
      const step = this.matchTotp(row, normalize(code));
      if (step === null) throw this.invalid(auth.userId, 'enroll');
      await this.repo.enable(q, auth.userId, step);
      await this.repo.replaceRecoveryCodes(
        q,
        auth.userId,
        codes.map((c) => sha256(c)),
      );
      // The user just proved possession in this session.
      await this.sessions.markMfa(q, auth.sessionId);
      await this.audit.record(q, ctx, {
        action: 'MFA_ENABLED',
        objectType: 'user',
        objectId: auth.userId,
      });
    });
    this.securityEvent('mfa_enabled', auth.userId);
    return { recoveryCodes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
  }

  async disable(auth: AuthContext, code: string, ctx: RequestContext): Promise<void> {
    await this.db.tx(async (q) => {
      const row = await this.repo.find(auth.userId, q, true);
      if (!row?.enabledAt)
        throw new AppError('MFA_NOT_ENABLED', 'Two-factor authentication is off');
      if (!(await this.consume(q, row, code, ctx))) throw this.invalid(auth.userId, 'disable');
      await this.repo.remove(q, auth.userId);
      await this.audit.record(q, ctx, {
        action: 'MFA_DISABLED',
        objectType: 'user',
        objectId: auth.userId,
      });
    });
    this.securityEvent('mfa_disabled', auth.userId);
  }

  /**
   * Second factor at login (after the password was verified). Returns true
   * when the session is established with MFA, false for accounts without it.
   */
  async verifyLogin(
    user: UserRow,
    code: string | undefined,
    ctx: RequestContext,
  ): Promise<boolean> {
    const row = await this.repo.find(user.id);
    if (!row?.enabledAt) return false;
    if (!code) throw new AppError('MFA_REQUIRED', 'Enter the code from your authenticator app');
    const ok = await this.db.tx(async (q) => {
      const locked = await this.repo.find(user.id, q, true);
      return !!locked?.enabledAt && (await this.consume(q, locked, code, ctx));
    });
    if (!ok) throw this.invalid(user.id, 'login');
    return true;
  }

  /** Accepts a TOTP code (once per time step) or an unused recovery code. */
  private async consume(
    q: Queryable,
    row: MfaRow,
    code: string,
    ctx: RequestContext,
  ): Promise<boolean> {
    const input = normalize(code);
    if (/^\d{6}$/.test(input)) {
      const step = this.matchTotp(row, input);
      return step !== null && (await this.repo.useStep(q, row.userId, step));
    }
    if (input.length !== RECOVERY_CODE_LENGTH) return false;
    if (!(await this.repo.useRecoveryCode(q, row.userId, sha256(input)))) return false;
    await this.audit.record(q, ctx, {
      action: 'MFA_RECOVERY_CODE_USED',
      objectType: 'user',
      objectId: row.userId,
    });
    this.securityEvent('mfa_recovery_code_used', row.userId);
    return true;
  }

  private matchTotp(row: MfaRow, code: string): number | null {
    const secret = this.box.open(row.secretEnc, row.userId);
    try {
      return verifyTotp(secret, code, Date.now(), row.lastUsedStep);
    } finally {
      secret.fill(0);
    }
  }

  private invalid(userId: string, during: string): AppError {
    this.securityEvent('mfa_failed', userId, { during });
    return new AppError('MFA_INVALID', 'Invalid authentication code');
  }

  private securityEvent(type: string, userId: string, fields: Record<string, unknown> = {}): void {
    this.metrics.securityEvents.inc({ type });
    this.logger.log({ securityEvent: type, userId, ...fields }, 'security_event');
  }
}
