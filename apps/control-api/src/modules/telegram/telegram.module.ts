import { Module } from '@nestjs/common';
import { OperatorsCoreModule } from '../operators/operators-core.module';
import { StoreModule } from '../store/store.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramClientModule } from './telegram-client.module';
import { TelegramController } from './telegram.controller';

/** Telegram bot and Mini App support (ADR-018). Inactive without a bot token. */
@Module({
  imports: [TelegramClientModule, StoreModule, OperatorsCoreModule],
  controllers: [TelegramController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
