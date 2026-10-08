import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/auth/public.decorator';
import { AppError } from '../../common/errors/app-error';
import { NoRateLimit } from '../../common/rate-limit/no-rate-limit.decorator';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { InternalChatInput, internalChatSchema } from '../chat/chat.schemas';
import { ChatSendResult, ChatService } from '../chat/chat.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { SessionsRepository } from '../identity/sessions.repository';
import { UsersRepository } from '../identity/users.repository';
import { TablesRepository } from '../tables/tables.repository';
import { InternalServiceGuard } from './internal-service.guard';

const accessQuery = z.object({
  userId: uuidSchema,
  // The viewer's session: platform-admin oversight needs a second factor.
  sessionId: uuidSchema.optional(),
});

export interface TableAccessDecision {
  allowed: boolean;
  clubId?: string;
  code?: string;
}

/**
 * Service-to-service endpoints (never exposed by the edge). The realtime
 * gateway asks here whether a user may subscribe to / act at a table, so
 * authorization rules stay in one place (control-api).
 */
@Public()
@NoRateLimit()
@UseGuards(InternalServiceGuard)
@Controller('internal/v1')
export class InternalController {
  constructor(
    private readonly tables: TablesRepository,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly access: ClubAccessService,
    private readonly chat: ChatService,
  ) {}

  @Get('tables/:tableId/access')
  async tableAccess(
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Query(new ZodPipe(accessQuery)) query: z.infer<typeof accessQuery>,
  ): Promise<TableAccessDecision> {
    const table = await this.tables.find(tableId);
    if (!table) return { allowed: false, code: 'TABLE_NOT_FOUND' };
    const user = await this.users.findById(query.userId);
    if (!user) return { allowed: false, code: 'AUTH_REQUIRED' };
    if (user.status !== 'ACTIVE') return { allowed: false, code: 'ACCOUNT_SUSPENDED' };
    const session = query.sessionId
      ? await this.sessions.authState(query.sessionId, user.id)
      : null;
    const mfa = !!session && session.mfa && !session.sessionRevoked && !session.sessionExpired;
    try {
      await this.access.require(
        table.clubId,
        {
          userId: user.id,
          sessionId: query.sessionId ?? 'internal',
          platformRole: user.platformRole,
          mfa,
        },
        'CLUB_VIEW',
      );
      return { allowed: true, clubId: table.clubId };
    } catch (err) {
      if (err instanceof AppError) return { allowed: false, clubId: table.clubId, code: err.code };
      throw err;
    }
  }

  /**
   * CHAT_SEND from a gateway connection. Errors use the standard envelope;
   * the gateway answers the client with an ERROR frame carrying the code.
   */
  @Post('tables/:tableId/chat')
  @HttpCode(200)
  sendChat(
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Body(new ZodPipe(internalChatSchema)) body: InternalChatInput,
  ): Promise<ChatSendResult> {
    return this.chat.send(tableId, body);
  }
}
