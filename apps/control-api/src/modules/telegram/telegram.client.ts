import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/config';

/** A Bot API call that Telegram refused (or that never reached it). */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    description: string,
  ) {
    super(`telegram ${method} failed (${status}): ${description}`);
    this.name = 'TelegramApiError';
  }
}

/**
 * Minimal Bot API client. The bot token is part of the request URL, so
 * URLs and transport errors are never logged.
 */
@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.TELEGRAM_BOT_TOKEN);
  }

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const token = this.config.TELEGRAM_BOT_TOKEN;
    if (!token) throw new AppError('TELEGRAM_NOT_CONFIGURED', 'Telegram is not configured');
    const base = this.config.TELEGRAM_API_URL.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      this.logger.warn({ method }, 'telegram_api_unreachable');
      throw new TelegramApiError(method, 0, 'unreachable');
    }
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    } | null;
    if (!body?.ok) {
      const description = body?.description ?? 'request failed';
      this.logger.warn({ method, status: res.status, description }, 'telegram_api_error');
      throw new TelegramApiError(method, body?.error_code ?? res.status, description);
    }
    return body.result as T;
  }

  sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.call<unknown>('sendMessage', { chat_id: chatId, text, ...extra });
  }
}
