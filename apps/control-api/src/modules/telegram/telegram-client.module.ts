import { Module } from '@nestjs/common';
import { TelegramClient } from './telegram.client';

/** The Bot API client alone, for modules the bot itself depends on (store). */
@Module({
  providers: [TelegramClient],
  exports: [TelegramClient],
})
export class TelegramClientModule {}
