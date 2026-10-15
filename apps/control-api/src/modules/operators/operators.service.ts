import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Database, isUniqueViolation } from '../../infra/database/database';
import { AuditService } from '../audit/audit.service';
import { SessionRevocationPublisher } from '../identity/session-revocation.publisher';
import { SessionsRepository } from '../identity/sessions.repository';
import { TelegramApiError, TelegramClient } from '../telegram/telegram.client';
import { OperatorBotsService } from './operator-bots.service';
import { OperatorRow, OperatorsRepository, OperatorStatus } from './operators.repository';
import type { OperatorsQuery, RegisterOperatorInput, SetStatusInput } from './operators.schemas';

export interface OperatorDto {
  id: string;
  slug: string;
  name: string;
  status: OperatorStatus;
  statusReason: string | null;
  botUsername: string;
  miniAppUrl: string;
  ownerUserId: string;
  ownerUsername: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface OperatorPublicDto {
  slug: string;
  name: string;
  botUsername: string;
}

/** Slugs that would be confusing as someone else's service. */
const RESERVED_SLUGS = new Set(['kofclub', 'admin', 'api', 'www', 'store', 'support', 'help']);

/** Which status an admin may move an operator to from each status. */
const TRANSITIONS: Record<OperatorStatus, OperatorStatus[]> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  REJECTED: ['ACTIVE'],
};

interface BotIdentity {
  id: number;
  is_bot: boolean;
  username?: string;
}

/**
 * Operators (T3, ADR-019): people who run KofClub under their own Telegram
 * bot. They register the bot themselves; a platform administrator approves
 * it, which connects the bot to this service. Each operator's players and
 * clubs form a separate world, with the same rules (virtual chips only).
 */
@Injectable()
export class OperatorsService {
  private readonly logger = new Logger(OperatorsService.name);

  constructor(
    private readonly db: Database,
    private readonly repo: OperatorsRepository,
    private readonly bots: OperatorBotsService,
    private readonly telegram: TelegramClient,
    private readonly sessions: SessionsRepository,
    private readonly revocations: SessionRevocationPublisher,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  toDto(o: OperatorRow): OperatorDto {
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      status: o.status,
      statusReason: o.statusReason,
      botUsername: o.botUsername,
      miniAppUrl: this.bots.miniAppUrl(o.slug),
      ownerUserId: o.ownerUserId,
      ownerUsername: o.ownerUsername,
      createdAt: o.createdAt.toISOString(),
      reviewedAt: o.reviewedAt?.toISOString() ?? null,
    };
  }

  async register(
    auth: AuthContext,
    input: RegisterOperatorInput,
    ctx: RequestContext,
  ): Promise<OperatorDto> {
    this.bots.requireEnabled();
    if (auth.operatorId !== null) {
      throw new AppError('FORBIDDEN', 'Register an operator from your KofClub account');
    }
    if (RESERVED_SLUGS.has(input.slug)) {
      throw new AppError('OPERATOR_SLUG_TAKEN', 'This address is reserved; choose another');
    }
    const bot = await this.identify(input.botToken);
    const id = uuidv7();
    try {
      await this.db.tx(async (q) => {
        if ((await this.repo.countByOwner(q, auth.userId)) >= this.config.MAX_OPERATORS_PER_USER) {
          throw new AppError('OPERATOR_LIMIT', 'You have registered the maximum number of bots');
        }
        await this.repo.insert(q, {
          id,
          slug: input.slug,
          name: input.name,
          ownerUserId: auth.userId,
          botId: bot.id,
          botUsername: bot.username,
          botTokenSealed: this.bots.seal(id, input.botToken),
        });
        await this.audit.record(q, ctx, {
          action: 'OPERATOR_REGISTERED',
          objectType: 'operator',
          objectId: id,
          after: { slug: input.slug, name: input.name, botUsername: bot.username },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'operators_slug_key')) {
        throw new AppError('OPERATOR_SLUG_TAKEN', 'This address is taken; choose another');
      }
      if (isUniqueViolation(err, 'operators_bot_key')) {
        throw new AppError('OPERATOR_BOT_TAKEN', 'This bot is already registered');
      }
      throw err;
    }
    return this.toDto((await this.repo.find(id))!);
  }

  async mine(auth: AuthContext): Promise<OperatorDto[]> {
    return (await this.repo.listByOwner(auth.userId)).map((o) => this.toDto(o));
  }

  /** A new token for the same bot (after /revoke in BotFather). */
  async replaceToken(
    auth: AuthContext,
    operatorId: string,
    token: string,
    ctx: RequestContext,
  ): Promise<OperatorDto> {
    this.bots.requireEnabled();
    const operator = await this.repo.find(operatorId);
    if (!operator || operator.ownerUserId !== auth.userId) {
      throw new AppError('OPERATOR_NOT_FOUND', 'No such operator');
    }
    const bot = await this.identify(token, true);
    if (bot.id !== operator.botId) {
      throw new AppError('OPERATOR_BOT_INVALID', `This token is not for @${operator.botUsername}`);
    }
    await this.repo.setBotToken(operator.id, this.bots.seal(operator.id, token));
    const updated = (await this.repo.find(operator.id))!;
    if (updated.status === 'ACTIVE') await this.connect(updated);
    await this.audit.record(this.db, ctx, {
      action: 'OPERATOR_BOT_TOKEN_REPLACED',
      objectType: 'operator',
      objectId: operator.id,
    });
    return this.toDto(updated);
  }

  async publicInfo(slug: string): Promise<OperatorPublicDto> {
    const operator = this.bots.enabled ? await this.repo.findBySlug(slug) : null;
    if (!operator || operator.status !== 'ACTIVE') {
      throw new AppError('OPERATOR_NOT_FOUND', 'No such service');
    }
    return { slug: operator.slug, name: operator.name, botUsername: operator.botUsername };
  }

  async adminList(query: OperatorsQuery): Promise<Page<OperatorDto>> {
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    const rows = await this.repo.list(query.status, query.limit + 1, after ?? null);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((o) => this.toDto(o)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.cursorKey, id: last.id })
          : null,
    };
  }

  /**
   * Approves (connects the bot to this service), suspends (disconnects it
   * and signs everyone in that world out) or rejects an operator.
   */
  async setStatus(
    auth: AuthContext,
    operatorId: string,
    input: SetStatusInput,
    ctx: RequestContext,
  ): Promise<OperatorDto> {
    this.bots.requireEnabled();
    const operator = await this.repo.find(operatorId);
    if (!operator) throw new AppError('OPERATOR_NOT_FOUND', 'No such operator');
    if (!TRANSITIONS[operator.status].includes(input.status)) {
      throw new AppError(
        'CONFLICT',
        `An operator that is ${operator.status} cannot become ${input.status}`,
      );
    }
    if (input.status === 'ACTIVE') await this.connect(operator);
    else await this.disconnect(operator);
    const revoked = await this.db.tx(async (q) => {
      await this.repo.setStatus(q, operator.id, {
        status: input.status,
        reason: input.reason,
        reviewedBy: auth.userId,
      });
      const sessionIds =
        input.status === 'ACTIVE' ? [] : await this.sessions.revokeAllForOperator(q, operator.id);
      await this.audit.record(q, ctx, {
        action: 'OPERATOR_STATUS_CHANGED',
        objectType: 'operator',
        objectId: operator.id,
        before: { status: operator.status },
        after: { status: input.status, reason: input.reason, revokedSessions: sessionIds.length },
      });
      return sessionIds;
    });
    if (revoked.length) await this.revocations.publish(revoked);
    return this.toDto((await this.repo.find(operator.id))!);
  }

  /** Asks Telegram who the token belongs to. */
  private async identify(
    token: string,
    existing = false,
  ): Promise<{ id: number; username: string }> {
    let me: BotIdentity;
    try {
      me = await this.telegram.call<BotIdentity>('getMe', {}, token);
    } catch (err) {
      if (err instanceof TelegramApiError) {
        throw new AppError('OPERATOR_BOT_INVALID', 'Telegram did not accept this bot token');
      }
      throw err;
    }
    if (!me.is_bot || !me.username) {
      throw new AppError('OPERATOR_BOT_INVALID', 'This token does not belong to a bot');
    }
    const ownBot = this.config.TELEGRAM_BOT_USERNAME?.toLowerCase();
    if (!existing && ownBot && me.username.toLowerCase() === ownBot) {
      throw new AppError('OPERATOR_BOT_TAKEN', 'This bot is already registered');
    }
    return { id: me.id, username: me.username };
  }

  /**
   * Points the bot at this service: its webhook (with a fresh secret, of
   * which only the hash is kept), commands and the Play button.
   */
  private async connect(operator: OperatorRow): Promise<void> {
    const token = this.bots.tokenOf(operator);
    const secret = randomBytes(32).toString('base64url');
    const base = (this.config.TELEGRAM_WEBHOOK_BASE_URL ?? '').replace(/\/+$/, '');
    try {
      await this.telegram.call(
        'setWebhook',
        {
          url: `${base}/v1/telegram/operators/${operator.id}/webhook`,
          secret_token: secret,
          allowed_updates: ['message', 'pre_checkout_query'],
        },
        token,
      );
      await this.telegram.call(
        'setMyCommands',
        {
          commands: [
            { command: 'start', description: `Open ${operator.name}` },
            { command: 'help', description: 'What the bot can do' },
            { command: 'terms', description: 'Terms of use' },
            { command: 'paysupport', description: 'Payments' },
          ],
        },
        token,
      );
      await this.telegram.call(
        'setChatMenuButton',
        {
          menu_button: {
            type: 'web_app',
            text: 'Play',
            web_app: { url: this.bots.miniAppUrl(operator.slug) },
          },
        },
        token,
      );
    } catch (err) {
      if (err instanceof TelegramApiError) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          `Telegram did not accept the bot settings (${err.method}); check the token and try again`,
        );
      }
      throw err;
    }
    await this.repo.setWebhookSecretHash(operator.id, sha256Hex(secret));
  }

  /** Stops the bot's updates; the world closes either way. */
  private async disconnect(operator: OperatorRow): Promise<void> {
    await this.repo.setWebhookSecretHash(operator.id, null);
    try {
      await this.telegram.call('deleteWebhook', {}, this.bots.tokenOf(operator));
    } catch {
      this.logger.warn({ operatorId: operator.id }, 'operator_webhook_delete_failed');
    }
  }
}
