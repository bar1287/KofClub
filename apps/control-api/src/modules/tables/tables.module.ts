import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { GameServiceClient } from './game-service.client';
import { TablesController } from './tables.controller';
import { TablesRepository } from './tables.repository';
import { TablesService } from './tables.service';

@Module({
  imports: [ClubsModule],
  controllers: [TablesController],
  providers: [TablesService, TablesRepository, GameServiceClient],
  exports: [TablesRepository, GameServiceClient],
})
export class TablesModule {}
