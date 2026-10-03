import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { TablesModule } from '../tables/tables.module';
import { HistoryController } from './history.controller';
import { HistoryRepository } from './history.repository';
import { HistoryService } from './history.service';

@Module({
  imports: [ClubsModule, TablesModule],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryRepository],
})
export class HistoryModule {}
