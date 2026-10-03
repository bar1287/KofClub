import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { IdentityModule } from '../identity/identity.module';
import { TablesModule } from '../tables/tables.module';
import { InternalController } from './internal.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  imports: [ClubsModule, TablesModule, IdentityModule],
  controllers: [InternalController],
  providers: [InternalServiceGuard],
})
export class InternalModule {}
