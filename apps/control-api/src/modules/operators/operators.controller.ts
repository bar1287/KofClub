import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { PlatformAdminGuard } from '../admin/platform-admin.guard';
import {
  BotTokenInput,
  botTokenBodySchema,
  OperatorsQuery,
  operatorsQuerySchema,
  RegisterOperatorInput,
  registerOperatorSchema,
  SetStatusInput,
  setStatusSchema,
  slugSchema,
} from './operators.schemas';
import { OperatorsService } from './operators.service';

/** Operators register and manage their own bots (ADR-019). */
@Controller('operators')
export class OperatorsController {
  constructor(private readonly operators: OperatorsService) {}

  @Post()
  @RateLimit({ name: 'operators:register:user', by: 'user', limit: 5, windowSec: 3600 })
  register(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(registerOperatorSchema)) body: RegisterOperatorInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.operators.register(auth, body, ctx);
  }

  @Get('mine')
  async mine(@CurrentAuth() auth: AuthContext) {
    return { items: await this.operators.mine(auth) };
  }

  @Put(':operatorId/bot')
  @RateLimit({ name: 'operators:token:user', by: 'user', limit: 10, windowSec: 3600 })
  replaceToken(
    @CurrentAuth() auth: AuthContext,
    @Param('operatorId', new ZodPipe(uuidSchema)) operatorId: string,
    @Body(new ZodPipe(botTokenBodySchema)) body: BotTokenInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.operators.replaceToken(auth, operatorId, body.botToken, ctx);
  }

  @Public()
  @Get(':slug/public')
  publicInfo(@Param('slug', new ZodPipe(slugSchema)) slug: string) {
    return this.operators.publicInfo(slug);
  }
}

/** Operator review for platform administrators (audited). */
@Controller('admin/operators')
@UseGuards(PlatformAdminGuard)
export class OperatorsAdminController {
  constructor(private readonly operators: OperatorsService) {}

  @Get()
  list(@Query(new ZodPipe(operatorsQuerySchema)) q: OperatorsQuery) {
    return this.operators.adminList(q);
  }

  @Put(':operatorId/status')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('operatorId', new ZodPipe(uuidSchema)) operatorId: string,
    @Body(new ZodPipe(setStatusSchema)) body: SetStatusInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.operators.setStatus(auth, operatorId, body, ctx);
  }
}
