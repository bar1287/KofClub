import { Module } from '@nestjs/common';
import { OperatorBotsService } from './operator-bots.service';
import { OperatorsRepository } from './operators.repository';

/**
 * Operator lookups and bot tokens, with no dependencies of its own, so that
 * identity (sign-in) and the bot webhooks can use them (ADR-019).
 */
@Module({
  providers: [OperatorsRepository, OperatorBotsService],
  exports: [OperatorsRepository, OperatorBotsService],
})
export class OperatorsCoreModule {}
