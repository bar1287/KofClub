import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { CreateTournamentInput, createTournamentSchema } from './tournaments.schemas';
import { TournamentDetailDto, TournamentDto, TournamentsService } from './tournaments.service';

@Controller()
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post('clubs/:clubId/tournaments')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(createTournamentSchema)) body: CreateTournamentInput,
    @Ctx() ctx: RequestContext,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.create(auth, clubId, body, ctx);
  }

  @Get('clubs/:clubId/tournaments')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<{ items: TournamentDto[] }> {
    return { items: await this.tournaments.list(auth, clubId) };
  }

  @Get('tournaments/:tournamentId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('tournamentId', new ZodPipe(uuidSchema)) id: string,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.detail(auth, id);
  }

  @Post('tournaments/:tournamentId/register')
  @HttpCode(200)
  @RateLimit({ name: 'tournaments:register:user', by: 'user', limit: 30, windowSec: 60 })
  register(
    @CurrentAuth() auth: AuthContext,
    @Param('tournamentId', new ZodPipe(uuidSchema)) id: string,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.register(auth, id);
  }

  @Post('tournaments/:tournamentId/unregister')
  @HttpCode(200)
  unregister(
    @CurrentAuth() auth: AuthContext,
    @Param('tournamentId', new ZodPipe(uuidSchema)) id: string,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.unregister(auth, id);
  }

  @Post('tournaments/:tournamentId/start')
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('tournamentId', new ZodPipe(uuidSchema)) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.start(auth, id, ctx);
  }

  @Post('tournaments/:tournamentId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('tournamentId', new ZodPipe(uuidSchema)) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.cancel(auth, id, ctx);
  }
}
