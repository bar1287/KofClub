import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { cursorSchema, limitSchema, Page, uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import type { HandSummaryRow } from './history.repository';
import { HandDetailDto, HistoryService } from './history.service';

const pageQuery = z.object({ limit: limitSchema, cursor: cursorSchema });
const clubHandsQuery = pageQuery.extend({ tableId: uuidSchema.optional() });

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('me/hands')
  myHands(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>,
  ): Promise<Page<HandSummaryRow>> {
    return this.history.myHands(auth, q.limit, q.cursor);
  }

  @Get('hands/:handId')
  hand(
    @CurrentAuth() auth: AuthContext,
    @Param('handId', new ZodPipe(uuidSchema)) handId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<HandDetailDto> {
    return this.history.hand(auth, handId, ctx);
  }

  @Get('clubs/:clubId/hands')
  clubHands(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(clubHandsQuery)) q: z.infer<typeof clubHandsQuery>,
  ): Promise<Page<HandSummaryRow>> {
    return this.history.clubHands(auth, clubId, q.tableId, q.limit, q.cursor);
  }
}
