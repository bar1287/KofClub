import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TournamentsController } from './tournaments.controller';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [ClubsModule, LedgerModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentsRepository],
})
export class TournamentsModule {}
