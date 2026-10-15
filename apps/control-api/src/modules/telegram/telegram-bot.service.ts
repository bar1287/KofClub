import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { MetricsService } from '../../metrics/metrics.service';
import { TelegramClient } from './telegram.client';

/** The parts of a Bot API update this service reads. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  [other: string]: unknown;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
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

/**
 * Bot commands (ADR-018): /start opens the Mini App (a club join code in
 * the start payload opens that club's join page), /help, /terms and
 * /paysupport. Everything else is ignored: the bot does not chat.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly telegram: TelegramClient,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    const kind = msg ? (msg.text?.startsWith('/') ? 'command' : 'message') : 'other';
    this.metrics.telegramUpdates.inc({ kind });
    if (!msg?.text || msg.from?.is_bot) return;
    const cmd = parseCommand(msg.text, this.config.TELEGRAM_BOT_USERNAME);
    if (!cmd) return;
    const reply = this.reply(cmd.command, cmd.arg, msg.chat.type === 'private');
    if (!reply) return;
    try {
      await this.telegram.sendMessage(msg.chat.id, reply.text, reply.extra);
    } catch {
      // Logged by the client; a failed reply must not make Telegram retry.
    }
  }

  /** Mini App URL for a path (the bot opens it inside Telegram). */
  appUrl(path = '/'): string {
    const base = (this.config.TELEGRAM_MINI_APP_URL ?? '').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private openButton(text: string, code: string | null, privateChat: boolean) {
    // Mini App buttons work in private chats; groups get a t.me link that
    // opens the bot's main Mini App with the same club code.
    const path = code ? `/join?code=${encodeURIComponent(code)}` : '/';
    const startapp = code ? `?startapp=c-${encodeURIComponent(code)}` : '?startapp';
    const button = privateChat
      ? { text, web_app: { url: this.appUrl(path) } }
      : { text, url: `https://t.me/${this.config.TELEGRAM_BOT_USERNAME}${startapp}` };
    return { reply_markup: { inline_keyboard: [[button]] } };
  }

  private reply(
    command: string,
    arg: string,
    privateChat: boolean,
  ): { text: string; extra: Record<string, unknown> } | null {
    switch (command) {
      case 'start': {
        const code = joinCodeFromStartParam(arg);
        return {
          text: code
            ? `You're invited to a KofClub poker club (code ${code}). Tap below to join.`
            : 'KofClub: private poker clubs with friends. Play with virtual chips; they have no money value and cannot be cashed out.',
          extra: this.openButton(code ? 'Join the club' : 'Open KofClub', code, privateChat),
        };
      }
      case 'help':
        return {
          text: [
            '/start: open KofClub',
            '/terms: terms of use',
            '/paysupport: help with a Telegram Stars purchase',
            'Share a club link from the club page to invite friends.',
          ].join('\n'),
          extra: {},
        };
      case 'terms':
        return {
          text:
            'KofClub is a social game. Chips are virtual, have no monetary value and can never be ' +
            'bought, sold or exchanged for money or prizes. Playing for money, in or outside the ' +
            `app, is forbidden. Full terms: ${this.appUrl('/terms')}`,
          extra: { link_preview_options: { is_disabled: true } },
        };
      case 'paysupport':
        return {
          text:
            'Telegram Stars buy Club Pro, premium themes and tips: never chips. For a problem ' +
            'with a purchase, write to ' +
            (this.config.TELEGRAM_SUPPORT_CONTACT ?? 'the operators of this KofClub service') +
            ' with the date and the item. Refunds go back to your Stars balance.',
          extra: {},
        };
      default:
        return null;
    }
  }
}
