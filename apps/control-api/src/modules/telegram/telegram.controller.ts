import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/auth/public.decorator';
import { constantTimeEqual } from '../../common/crypto';
import { AppError } from '../../common/errors/app-error';
import { NoRateLimit } from '../../common/rate-limit/no-rate-limit.decorator';
import { Ctx, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { OperatorBotsService } from '../operators/operator-bots.service';
import { TelegramBotService, TelegramUpdate } from './telegram-bot.service';

export const telegramUpdateSchema = z.object({ update_id: z.number().int() }).passthrough();

export interface TelegramConfigDto {
  enabled: boolean;
  botUsername: string | null;
  storeEnabled: boolean;
  operatorsEnabled: boolean;
}

@Public()
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly operatorBots: OperatorBotsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('config')
  settings(): TelegramConfigDto {
    const enabled = Boolean(this.config.TELEGRAM_BOT_TOKEN);
    return {
      enabled,
      botUsername: enabled ? (this.config.TELEGRAM_BOT_USERNAME ?? null) : null,
      storeEnabled: enabled && this.config.TELEGRAM_STARS_ENABLED,
      operatorsEnabled: this.operatorBots.enabled,
    };
  }

  /** Bot API updates. Only Telegram knows the webhook secret. */
  @Post('webhook')
  @HttpCode(200)
  @NoRateLimit()
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body(new ZodPipe(telegramUpdateSchema)) update: TelegramUpdate,
    @Ctx() ctx: RequestContext,
  ): Promise<{ ok: true }> {
    const expected = this.config.TELEGRAM_WEBHOOK_SECRET;
    if (!this.config.TELEGRAM_BOT_TOKEN || !expected) {
      throw new AppError('NOT_FOUND', 'Route not found');
    }
    if (!secret || !constantTimeEqual(secret, expected)) {
      throw new AppError('AUTH_REQUIRED', 'Invalid webhook secret');
    }
    await this.bot.handleUpdate(update, ctx);
    return { ok: true };
  }

  /** Updates for an operator's bot (ADR-019); the secret is per operator. */
  @Post('operators/:operatorId/webhook')
  @HttpCode(200)
  @NoRateLimit()
  async operatorWebhook(
    @Param('operatorId', new ZodPipe(uuidSchema)) operatorId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body(new ZodPipe(telegramUpdateSchema)) update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const bot = await this.operatorBots.forWebhook(operatorId, secret);
    await this.bot.handleOperatorUpdate(update, bot);
    return { ok: true };
  }
}
