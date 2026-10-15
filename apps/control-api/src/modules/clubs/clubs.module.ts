import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { ClubAccessService } from './club-access.service';
import { ClubsController } from './clubs.controller';
import { ClubsRepository } from './clubs.repository';
import { ClubsService } from './clubs.service';

@Module({
  imports: [PlansModule],
  controllers: [ClubsController],
  providers: [ClubsService, ClubsRepository, ClubAccessService],
  exports: [ClubAccessService, ClubsRepository],
})
export class ClubsModule {}
