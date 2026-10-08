import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import type { TableRow } from './tables.repository';
import {
  AutoTopUpInput,
  autoTopUpSchema,
  CreateTableInput,
  createTableSchema,
  SeatInput,
  seatSchema,
  TopUpInput,
  topUpSchema,
} from './tables.schemas';
import {
  AutoTopUpResultDto,
  CloseResultDto,
  LeaveResultDto,
  SeatResultDto,
  TableDetailDto,
  TablesService,
  TopUpResultDto,
} from './tables.service';

@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Post('clubs/:clubId/tables')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(createTableSchema)) body: CreateTableInput,
    @Ctx() ctx: RequestContext,
  ): Promise<TableDetailDto> {
    return this.tables.create(auth, clubId, body, ctx);
  }

  @Get('clubs/:clubId/tables')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<{ items: TableRow[] }> {
    return { items: await this.tables.list(auth, clubId) };
  }

  @Get('tables/:tableId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
  ): Promise<TableDetailDto> {
    return this.tables.detail(auth, tableId);
  }

  @Post('tables/:tableId/seat')
  @HttpCode(200)
  @RateLimit({ name: 'tables:seat:user', by: 'user', limit: 30, windowSec: 60 })
  seat(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Body(new ZodPipe(seatSchema)) body: SeatInput,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<SeatResultDto> {
    return this.tables.seat(auth, tableId, body, key, ctx);
  }

  @Post('tables/:tableId/top-up')
  @HttpCode(200)
  @RateLimit({ name: 'tables:topup:user', by: 'user', limit: 30, windowSec: 60 })
  topUp(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Body(new ZodPipe(topUpSchema)) body: TopUpInput,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<TopUpResultDto> {
    return this.tables.topUp(auth, tableId, body, key, ctx);
  }

  @Put('tables/:tableId/auto-top-up')
  @RateLimit({ name: 'tables:auto-topup:user', by: 'user', limit: 30, windowSec: 60 })
  autoTopUp(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Body(new ZodPipe(autoTopUpSchema)) body: AutoTopUpInput,
    @Ctx() ctx: RequestContext,
  ): Promise<AutoTopUpResultDto> {
    return this.tables.setAutoTopUp(auth, tableId, body, ctx);
  }

  @Post('tables/:tableId/leave')
  @HttpCode(200)
  leave(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<LeaveResultDto> {
    return this.tables.leave(auth, tableId, key, ctx);
  }

  @Post('tables/:tableId/close')
  @HttpCode(200)
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<CloseResultDto> {
    return this.tables.close(auth, tableId, ctx);
  }

  @Get('tables/:tableId/state')
  state(
    @CurrentAuth() auth: AuthContext,
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<unknown> {
    return this.tables.state(auth, tableId, ctx);
  }
}
