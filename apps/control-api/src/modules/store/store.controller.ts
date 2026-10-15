import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { PlatformAdminGuard } from '../admin/platform-admin.guard';
import {
  CreateOrderInput,
  createOrderSchema,
  PaymentsQuery,
  paymentsQuerySchema,
  RefundInput,
  refundSchema,
  RenewalInput,
  renewalSchema,
} from './store.schemas';
import { StoreService } from './store.service';

/** The Telegram Stars store and club plans (T2, ADR-018). */
@Controller()
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get('store')
  catalog(@CurrentAuth() auth: AuthContext) {
    return this.store.catalog(auth);
  }

  @Post('store/orders')
  @RateLimit({ name: 'store:order:user', by: 'user', limit: 20, windowSec: 600 })
  createOrder(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput,
  ) {
    return this.store.createOrder(auth, body);
  }

  @Get('me/store')
  myStore(@CurrentAuth() auth: AuthContext) {
    return this.store.myStore(auth.userId);
  }

  @Get('clubs/:clubId/plan')
  clubPlan(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ) {
    return this.store.clubPlan(auth, clubId);
  }

  @Put('clubs/:clubId/plan/renewal')
  setRenewal(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(renewalSchema)) body: RenewalInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.store.setRenewal(auth, clubId, body.renewing, ctx);
  }
}

/** Stars payments for platform administrators (refunds are audited). */
@Controller('admin/star-payments')
@UseGuards(PlatformAdminGuard)
export class StoreAdminController {
  constructor(private readonly store: StoreService) {}

  @Get()
  payments(@Query(new ZodPipe(paymentsQuerySchema)) q: PaymentsQuery) {
    return this.store.adminPayments(q);
  }

  @Post(':paymentId/refund')
  @HttpCode(200)
  refund(
    @Param('paymentId', new ZodPipe(uuidSchema)) paymentId: string,
    @Body(new ZodPipe(refundSchema)) body: RefundInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.store.adminRefund(paymentId, body.reason, ctx);
  }
}
