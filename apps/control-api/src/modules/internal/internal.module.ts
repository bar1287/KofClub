import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ClubsModule } from '../clubs/clubs.module';
import { IdentityModule } from '../identity/identity.module';
import { TablesModule } from '../tables/tables.module';
import { InternalController } from './internal.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  imports: [ClubsModule, TablesModule, IdentityModule, ChatModule],
  controllers: [InternalController],
  providers: [InternalServiceGuard],
})
export class InternalModule {}
