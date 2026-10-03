import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { limitSchema, Page, uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AuditRecordDto, AuditService } from '../audit/audit.service';
import { ClubAccessService } from './club-access.service';
import { ClubDto, InviteDto, MemberDto } from './clubs.dto';
import {
  CreateClubInput,
  createClubSchema,
  CreateInviteInput,
  createInviteSchema,
  JoinClubInput,
  joinClubSchema,
  ListMembersQuery,
  listMembersQuerySchema,
  TransferOwnershipInput,
  transferOwnershipSchema,
  UpdateClubInput,
  updateClubSchema,
  UpdateMemberInput,
  updateMemberSchema,
} from './clubs.schemas';
import { ClubsService } from './clubs.service';
import { z } from 'zod';

const joinRateLimit = { name: 'clubs:join:user', by: 'user' as const, limit: 20, windowSec: 600 };
const auditQuerySchema = z.object({ limit: limitSchema, cursor: z.string().max(512).optional() });

@Controller('clubs')
export class ClubsController {
  constructor(
    private readonly clubs: ClubsService,
    private readonly access: ClubAccessService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RateLimit({ name: 'clubs:create:user', by: 'user', limit: 10, windowSec: 3600 })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createClubSchema)) body: CreateClubInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.create(auth, body, ctx);
  }

  @Get()
  async listMine(@CurrentAuth() auth: AuthContext): Promise<{ items: ClubDto[] }> {
    return { items: await this.clubs.listMine(auth) };
  }

  @Post('join')
  @HttpCode(200)
  @RateLimit(joinRateLimit)
  joinByCode(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(joinClubSchema)) body: JoinClubInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.join(auth, body.code, ctx);
  }

  @Get(':clubId')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<ClubDto> {
    return this.clubs.get(auth, clubId);
  }

  @Patch(':clubId')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(updateClubSchema)) body: UpdateClubInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.update(auth, clubId, body, ctx);
  }

  @Post(':clubId/transfer-ownership')
  @HttpCode(200)
  transferOwnership(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(transferOwnershipSchema)) body: TransferOwnershipInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.transferOwnership(auth, clubId, body, ctx);
  }

  @Post(':clubId/join')
  @HttpCode(200)
  @RateLimit(joinRateLimit)
  join(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(joinClubSchema)) body: JoinClubInput,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.join(auth, body.code, ctx, clubId);
  }

  @Post(':clubId/leave')
  @HttpCode(204)
  async leave(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.clubs.leave(auth, clubId, ctx);
  }

  @Post(':clubId/join-code/rotate')
  @HttpCode(200)
  rotateJoinCode(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<ClubDto> {
    return this.clubs.rotateJoinCode(auth, clubId, ctx);
  }

  @Get(':clubId/members')
  listMembers(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(listMembersQuerySchema)) query: ListMembersQuery,
  ): Promise<Page<MemberDto>> {
    return this.clubs.listMembers(auth, clubId, query);
  }

  @Patch(':clubId/members/:userId')
  updateMember(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Param('userId', new ZodPipe(uuidSchema)) userId: string,
    @Body(new ZodPipe(updateMemberSchema)) body: UpdateMemberInput,
    @Ctx() ctx: RequestContext,
  ): Promise<MemberDto> {
    return this.clubs.updateMember(auth, clubId, userId, body, ctx);
  }

  @Post(':clubId/invites')
  @RateLimit({ name: 'clubs:invites:user', by: 'user', limit: 60, windowSec: 3600 })
  createInvite(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(createInviteSchema)) body: CreateInviteInput,
    @Ctx() ctx: RequestContext,
  ): Promise<{ invite: InviteDto; code: string }> {
    return this.clubs.createInvite(auth, clubId, body, ctx);
  }

  @Get(':clubId/invites')
  async listInvites(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<{ items: InviteDto[] }> {
    return { items: await this.clubs.listInvites(auth, clubId) };
  }

  @Delete(':clubId/invites/:inviteId')
  @HttpCode(204)
  async revokeInvite(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Param('inviteId', new ZodPipe(uuidSchema)) inviteId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.clubs.revokeInvite(auth, clubId, inviteId, ctx);
  }

  @Get(':clubId/audit-log')
  async auditLog(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ): Promise<Page<AuditRecordDto>> {
    await this.access.require(clubId, auth, 'AUDIT_VIEW');
    return this.audit.list({ clubId }, query.limit, query.cursor);
  }
}
