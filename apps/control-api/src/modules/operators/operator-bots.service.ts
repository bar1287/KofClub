import { Inject, Injectable } from '@nestjs/common';
import { constantTimeEqual, sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { SecretBox } from '../../common/secret-box';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { OperatorRow, OperatorsRepository } from './operators.repository';

/** An operator's bot, ready to call the Bot API with. */
export interface OperatorBot {
  operator: OperatorRow;
  token: string;
}

/**
 * Operators' bots (ADR-019): tokens are sealed at rest (AES-256-GCM, bound to
 * the operator id) and unsealed only to call Telegram or check launch data.
 */
@Injectable()
export class OperatorBotsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly operators: OperatorsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = config.OPERATOR_SECRET_KEY_B64
      ? new SecretBox(config.OPERATOR_SECRET_KEY_B64)
      : null;
  }

  get enabled(): boolean {
    return this.config.OPERATORS_ENABLED && this.box !== null;
  }

  requireEnabled(): void {
    if (!this.enabled) throw new AppError('OPERATORS_DISABLED', 'Operators are not available here');
  }

  seal(operatorId: string, token: string): Buffer {
    this.requireEnabled();
    return this.box!.seal(Buffer.from(token, 'utf8'), `operator-bot:${operatorId}`);
  }

  tokenOf(operator: OperatorRow): string {
    this.requireEnabled();
    return this.box!.open(operator.botTokenSealed, `operator-bot:${operator.id}`).toString('utf8');
  }

  /** The bot of an active operator, for signing in to its world. */
  async activeBySlug(slug: string): Promise<OperatorBot> {
    this.requireEnabled();
    const operator = await this.operators.findBySlug(slug);
    if (!operator) throw new AppError('OPERATOR_NOT_FOUND', 'No such service');
    if (operator.status !== 'ACTIVE') {
      throw new AppError('OPERATOR_UNAVAILABLE', 'This service is not available right now');
    }
    return { operator, token: this.tokenOf(operator) };
  }

  /**
   * The bot a webhook call is for, when its secret matches. Unknown, inactive
   * or unconnected operators look like a missing route.
   */
  async forWebhook(operatorId: string, secret: string | undefined): Promise<OperatorBot> {
    const operator = this.enabled ? await this.operators.find(operatorId) : null;
    if (!operator || operator.status !== 'ACTIVE' || !operator.webhookSecretHash) {
      throw new AppError('NOT_FOUND', 'Route not found');
    }
    if (!secret || !constantTimeEqual(sha256Hex(secret), operator.webhookSecretHash)) {
      throw new AppError('AUTH_REQUIRED', 'Invalid webhook secret');
    }
    return { operator, token: this.tokenOf(operator) };
  }

  /** The Mini App URL that opens this operator's world. */
  miniAppUrl(slug: string, path = '/'): string {
    const base = (this.config.TELEGRAM_MINI_APP_URL ?? '').replace(/\/+$/, '');
    const sep = path.includes('?') ? '&' : '?';
    return `${base}${path}${sep}op=${encodeURIComponent(slug)}`;
  }
}
