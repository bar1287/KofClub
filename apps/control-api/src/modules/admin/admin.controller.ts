import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  AdminAuditQuery,
  auditQuerySchema,
  ReviewRiskInput,
  reviewRiskSchema,
  RiskQuery,
  riskQuerySchema,
  SearchQuery,
  searchQuerySchema,
  UpdateClubStatusInput,
  updateClubStatusSchema,
  UpdateUserStatusInput,
  updateUserStatusSchema,
} from './admin.schemas';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  users(@Query(new ZodPipe(searchQuerySchema)) q: SearchQuery) {
    return this.admin.users(q);
  }

  @Patch('users/:userId')
  setUserStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ZodPipe(uuidSchema)) userId: string,
    @Body(new ZodPipe(updateUserStatusSchema)) body: UpdateUserStatusInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.admin.setUserStatus(auth, userId, body, ctx);
  }

  @Get('clubs')
  clubs(@Query(new ZodPipe(searchQuerySchema)) q: SearchQuery) {
    return this.admin.clubs(q);
  }

  @Patch('clubs/:clubId')
  setClubStatus(
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(updateClubStatusSchema)) body: UpdateClubStatusInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.admin.setClubStatus(clubId, body, ctx);
  }

  @Get('audit-log')
  auditLog(@Query(new ZodPipe(auditQuerySchema)) q: AdminAuditQuery) {
    return this.admin.auditLog(q);
  }

  @Get('risk-events')
  riskEvents(@Query(new ZodPipe(riskQuerySchema)) q: RiskQuery) {
    return this.admin.riskEvents(q);
  }

  @Patch('risk-events/:eventId')
  reviewRisk(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', new ZodPipe(uuidSchema)) eventId: string,
    @Body(new ZodPipe(reviewRiskSchema)) body: ReviewRiskInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.admin.reviewRisk(auth, eventId, body, ctx);
  }
}
