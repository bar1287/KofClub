import { Module } from '@nestjs/common';
import { ClubPlansService } from './club-plans.service';
import { ClubSubscriptionsRepository } from './club-subscriptions.repository';

/** Club plans (Free / Club Pro) and their limits (T2, ADR-018). */
@Module({
  providers: [ClubPlansService, ClubSubscriptionsRepository],
  exports: [ClubPlansService],
})
export class PlansModule {}
