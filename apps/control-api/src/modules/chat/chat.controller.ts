import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { Page, uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  ListChatReportsQuery,
  listChatReportsQuerySchema,
  ReportChatInput,
  reportChatSchema,
  ResolveChatReportInput,
  resolveChatReportSchema,
} from './chat.schemas';
import { ChatHistoryDto, ChatReportDto, ChatService } from './chat.service';

/** Chat history, reports and moderation. Live messages use the realtime connection. */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('tables/:tableId/chat')
  history(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
  ): Promise<ChatHistoryDto> {
    return this.chat.history(auth, tableId);
  }

  @Post('tables/:tableId/chat/reports')
  @HttpCode(200)
  @RateLimit({ name: 'chat:report:user', by: 'user', limit: 20, windowSec: 3600 })
  report(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Body(new ZodPipe(reportChatSchema)) body: ReportChatInput,
  ): Promise<ChatReportDto> {
    return this.chat.report(auth, tableId, body);
  }

  @Get('clubs/:clubId/chat-reports')
  listReports(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(listChatReportsQuerySchema)) query: ListChatReportsQuery,
  ): Promise<Page<ChatReportDto>> {
    return this.chat.listReports(auth, clubId, query);
  }

  @Post('clubs/:clubId/chat-reports/:reportId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Param('reportId', new ZodPipe(uuidSchema)) reportId: string,
    @Body(new ZodPipe(resolveChatReportSchema)) body: ResolveChatReportInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ChatReportDto> {
    return this.chat.resolveReport(auth, clubId, reportId, body, ctx);
  }
}
