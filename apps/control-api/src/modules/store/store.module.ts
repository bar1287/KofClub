import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../admin/platform-admin.guard';
import { ClubsModule } from '../clubs/clubs.module';
import { IdentityModule } from '../identity/identity.module';
import { PlansModule } from '../plans/plans.module';
import { TelegramClientModule } from '../telegram/telegram-client.module';
import { StoreAdminController, StoreController } from './store.controller';
import { StoreRepository } from './store.repository';
import { StoreService } from './store.service';

/**
 * Telegram Stars store (T2, ADR-018): Club Pro, premium themes and tips.
 * Digital goods only; separate from the chip ledger.
 */
@Module({
  imports: [ClubsModule, IdentityModule, PlansModule, TelegramClientModule],
  controllers: [StoreController, StoreAdminController],
  providers: [StoreService, StoreRepository, PlatformAdminGuard],
  exports: [StoreService],
})
export class StoreModule {}
