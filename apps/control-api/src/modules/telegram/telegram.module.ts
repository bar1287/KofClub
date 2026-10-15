import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramClient } from './telegram.client';
import { TelegramController } from './telegram.controller';

/** Telegram bot and Mini App support (ADR-018). Inactive without a bot token. */
@Module({
  controllers: [TelegramController],
  providers: [TelegramClient, TelegramBotService],
  exports: [TelegramClient, TelegramBotService],
})
export class TelegramModule {}
