import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../../common/request-context';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { MetricsService } from '../../metrics/metrics.service';
import { OperatorBot, OperatorBotsService } from '../operators/operator-bots.service';
import { findProduct } from '../store/store.catalog';
import { PaymentOutcome, StoreService } from '../store/store.service';
import {
  preCheckoutQuerySchema,
  refundedPaymentSchema,
  successfulPaymentSchema,
} from '../store/telegram-payments';
import { TelegramClient } from './telegram.client';

/** The parts of a Bot API update this service reads. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  pre_checkout_query?: unknown;
  [other: string]: unknown;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
  successful_payment?: unknown;
  refunded_payment?: unknown;
  [other: string]: unknown;
}

/** Club join codes travel as start parameters: c-<CODE>. */
export function joinCodeFromStartParam(param: string | undefined | null): string | null {
  const m = /^c-([A-Za-z0-9]{6,16})$/.exec(param ?? '');
  return m ? m[1]!.toUpperCase() : null;
}

/** Parses "/start@bot payload" into the command and its argument. */
export function parseCommand(
  text: string | undefined,
  botUsername: string | undefined,
): { command: string; arg: string } | null {
  const m = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+(.*))?$/s.exec((text ?? '').trim());
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { command: m[1]!, arg: (m[3] ?? '').trim() };
}

/** Who a bot speaks for: KofClub's own bot, or an operator's (ADR-019). */
interface BotProfile {
  name: string;
  username: string | undefined;
  /** Null for KofClub's bot (the configured token). */
  token: string | undefined;
  appUrl(path: string): string;
  /** Operator bots sell nothing: payments are KofClub's own. */
  sells: boolean;
}

/**
 * Bot updates (ADR-018). Commands: /start opens the Mini App (a club join
 * code in the start payload opens that club's join page), /help, /terms and
 * /paysupport. Stars payments (T2): pre-checkout queries are answered, and
 * payments and refunds go to the store. Everything else is ignored: the bot
 * does not chat.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly telegram: TelegramClient,
    private readonly store: StoreService,
    private readonly operatorBots: OperatorBotsService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private platformProfile(): BotProfile {
    return {
      name: 'KofClub',
      username: this.config.TELEGRAM_BOT_USERNAME,
      token: undefined,
      appUrl: (path) => this.appUrl(path),
      sells: true,
    };
  }

  private operatorProfile(bot: OperatorBot): BotProfile {
    return {
      name: bot.operator.name,
      username: bot.operator.botUsername,
      token: bot.token,
      appUrl: (path) => this.operatorBots.miniAppUrl(bot.operator.slug, path),
      sells: false,
    };
  }

  /** An update for an operator's bot (ADR-019): commands only, no store. */
  async handleOperatorUpdate(update: TelegramUpdate, bot: OperatorBot): Promise<void> {
    const profile = this.operatorProfile(bot);
    if (update.pre_checkout_query) {
      this.metrics.telegramUpdates.inc({ kind: 'operator_pre_checkout_query' });
      const query = preCheckoutQuerySchema.safeParse(update.pre_checkout_query);
      if (!query.success) return;
      await this.telegram.call(
        'answerPreCheckoutQuery',
        {
          pre_checkout_query_id: query.data.id,
          ok: false,
          error_message: 'This bot does not sell anything.',
        },
        bot.token,
      );
      return;
    }
    this.metrics.telegramUpdates.inc({ kind: 'operator_message' });
    await this.answerCommand(update.message, profile);
  }

  /**
   * Handles one update. Payment errors propagate (the webhook answers 500
   * and Telegram delivers the update again; recording is idempotent).
   */
  async handleUpdate(update: TelegramUpdate, ctx: RequestContext): Promise<void> {
    const msg = update.message;
    const kind = update.pre_checkout_query
      ? 'pre_checkout_query'
      : msg?.successful_payment
        ? 'payment'
        : msg?.refunded_payment
          ? 'refund'
          : msg
            ? msg.text?.startsWith('/')
              ? 'command'
              : 'message'
            : 'other';
    this.metrics.telegramUpdates.inc({ kind });
    if (kind === 'pre_checkout_query') return this.answerPreCheckout(update.pre_checkout_query);
    if (kind === 'payment' && msg) return this.onPayment(msg, ctx);
    if (kind === 'refund' && msg) {
      const refund = refundedPaymentSchema.safeParse(msg.refunded_payment);
      if (refund.success)
        await this.store.paymentRefunded(refund.data.telegram_payment_charge_id, ctx);
      return;
    }
    await this.answerCommand(msg, this.platformProfile());
  }

  private async answerCommand(msg: TelegramMessage | undefined, bot: BotProfile): Promise<void> {
    if (!msg?.text || msg.from?.is_bot) return;
    const cmd = parseCommand(msg.text, bot.username);
    if (!cmd) return;
    const reply = this.reply(cmd.command, cmd.arg, msg.chat.type === 'private', bot);
    if (!reply) return;
    try {
      await this.telegram.sendMessage(msg.chat.id, reply.text, reply.extra, bot.token);
    } catch {
      // Logged by the client; a failed reply must not make Telegram retry.
    }
  }

  /** Telegram waits at most 10 seconds for this answer. */
  private async answerPreCheckout(raw: unknown): Promise<void> {
    const parsed = preCheckoutQuerySchema.safeParse(raw);
    if (!parsed.success) return;
    const query = parsed.data;
    let problem: string | null;
    try {
      problem = await this.store.preCheckout(query);
    } catch {
      problem = 'Purchases are not available right now. Please try again later.';
    }
    await this.telegram.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok: problem === null,
      ...(problem ? { error_message: problem } : {}),
    });
  }

  private async onPayment(msg: TelegramMessage, ctx: RequestContext): Promise<void> {
    const payment = successfulPaymentSchema.safeParse(msg.successful_payment);
    if (!payment.success || !msg.from) return;
    const outcome = await this.store.paymentReceived(msg.from.id, payment.data, ctx);
    if (outcome.duplicate) return;
    await this.telegram
      .sendMessage(msg.chat.id, this.thanks(outcome))
      .catch(() => undefined /* logged by the client */);
  }

  private thanks(outcome: PaymentOutcome): string {
    if (!outcome.matched || !outcome.product) {
      return (
        'Thank you! We received your payment but could not match it to a purchase. ' +
        'Send /paysupport and we will sort it out.'
      );
    }
    switch (findProduct(this.config, outcome.product).kind) {
      case 'SUBSCRIPTION':
        return (
          'Thank you! Club Pro is active' +
          (outcome.activeUntil ? ` until ${outcome.activeUntil.toISOString().slice(0, 10)}` : '') +
          '. It renews monthly; cancel any time on the club page.'
        );
      case 'ONE_TIME':
        return 'Thank you! Your premium themes are unlocked: choose them in the table settings.';
      default:
        return 'Thank you for the tip! It helps keep KofClub running.';
    }
  }

  /** Mini App URL for a path (the bot opens it inside Telegram). */
  appUrl(path = '/'): string {
    const base = (this.config.TELEGRAM_MINI_APP_URL ?? '').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private openButton(text: string, code: string | null, privateChat: boolean, bot: BotProfile) {
    // Mini App buttons work in private chats; groups get a t.me link that
    // opens the bot's main Mini App with the same club code.
    const path = code ? `/join?code=${encodeURIComponent(code)}` : '/';
    const startapp = code ? `?startapp=c-${encodeURIComponent(code)}` : '?startapp';
    const button = privateChat
      ? { text, web_app: { url: bot.appUrl(path) } }
      : { text, url: `https://t.me/${bot.username}${startapp}` };
    return { reply_markup: { inline_keyboard: [[button]] } };
  }

  private reply(
    command: string,
    arg: string,
    privateChat: boolean,
    bot: BotProfile,
  ): { text: string; extra: Record<string, unknown> } | null {
    const poweredBy = bot.sells ? '' : ' (powered by KofClub)';
    switch (command) {
      case 'start': {
        const code = joinCodeFromStartParam(arg);
        return {
          text: code
            ? `You're invited to a poker club on ${bot.name} (code ${code}). Tap below to join.`
            : `${bot.name}${poweredBy}: private poker clubs with friends. Play with virtual chips; ` +
              'they have no money value and cannot be cashed out.',
          extra: this.openButton(
            code ? 'Join the club' : `Open ${bot.name}`,
            code,
            privateChat,
            bot,
          ),
        };
      }
      case 'help':
        return {
          text: [
            `/start: open ${bot.name}`,
            '/terms: terms of use',
            bot.sells
              ? '/paysupport: help with a Telegram Stars purchase'
              : '/paysupport: payments',
            'Share a club link from the club page to invite friends.',
          ].join('\n'),
          extra: {},
        };
      case 'terms':
        return {
          text:
            `${bot.name} is a social game${poweredBy}. Chips are virtual, have no monetary value ` +
            'and can never be bought, sold or exchanged for money or prizes. Playing for money, ' +
            `in or outside the app, is forbidden. Full terms: ${bot.appUrl('/terms')}`,
          extra: { link_preview_options: { is_disabled: true } },
        };
      case 'paysupport':
        return {
          text: bot.sells
            ? 'Telegram Stars buy Club Pro, premium themes and tips: never chips. For a problem ' +
              'with a purchase, write to ' +
              (this.config.TELEGRAM_SUPPORT_CONTACT ?? 'the operators of this KofClub service') +
              ' with the date and the item. Refunds go back to your Stars balance.'
            : `${bot.name} sells nothing in this bot, and chips are always free. Nobody may ` +
              'charge you money to play.',
          extra: {},
        };
      default:
        return null;
    }
  }
}
