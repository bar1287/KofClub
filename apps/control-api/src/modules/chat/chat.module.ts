import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { IdentityModule } from '../identity/identity.module';
import { TablesModule } from '../tables/tables.module';
import { ChatController } from './chat.controller';
import { ChatPublisher } from './chat.publisher';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';

@Module({
  imports: [ClubsModule, TablesModule, IdentityModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRepository, ChatPublisher],
  exports: [ChatService],
})
export class ChatModule {}
