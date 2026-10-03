import { Module } from '@nestjs/common';
import { ClubAccessService } from './club-access.service';
import { ClubsController } from './clubs.controller';
import { ClubsRepository } from './clubs.repository';
import { ClubsService } from './clubs.service';

@Module({
  controllers: [ClubsController],
  providers: [ClubsService, ClubsRepository, ClubAccessService],
  exports: [ClubAccessService, ClubsRepository],
})
export class ClubsModule {}
