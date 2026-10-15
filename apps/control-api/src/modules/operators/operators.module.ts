import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../admin/platform-admin.guard';
import { IdentityModule } from '../identity/identity.module';
import { TelegramClientModule } from '../telegram/telegram-client.module';
import { OperatorsCoreModule } from './operators-core.module';
import { OperatorsAdminController, OperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';

/** Operator registration, review and public details (T3, ADR-019). */
@Module({
  imports: [IdentityModule, OperatorsCoreModule, TelegramClientModule],
  controllers: [OperatorsController, OperatorsAdminController],
  providers: [OperatorsService, PlatformAdminGuard],
})
export class OperatorsModule {}
