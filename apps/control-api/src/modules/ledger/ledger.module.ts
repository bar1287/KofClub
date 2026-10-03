import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { LedgerController } from './ledger.controller';
import { LedgerReadRepository } from './ledger.read-repository';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';

@Module({
  imports: [ClubsModule],
  controllers: [LedgerController],
  providers: [LedgerService, LedgerRepository, LedgerReadRepository],
  exports: [LedgerRepository],
})
export class LedgerModule {}
