import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, CurrentAuth } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AuthService, SessionDto, UserDto } from './auth.service';
import { TelegramLinkInput, telegramLinkSchema } from './identity.schemas';

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return this.auth.me(auth.userId);
  }

  @Post('telegram')
  @HttpCode(200)
  @RateLimit({ name: 'me:telegram:user', by: 'user', limit: 10, windowSec: 600 })
  linkTelegram(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(telegramLinkSchema)) body: TelegramLinkInput,
  ): Promise<UserDto> {
    return this.auth.linkTelegram(auth.userId, body.initData);
  }

  @Delete('telegram')
  @HttpCode(204)
  async unlinkTelegram(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.unlinkTelegram(auth.userId);
  }

  @Get('sessions')
  async sessions(@CurrentAuth() auth: AuthContext): Promise<{ items: SessionDto[] }> {
    return { items: await this.auth.listSessions(auth.userId, auth.sessionId) };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('sessionId', new ZodPipe(uuidSchema)) sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(auth.userId, sessionId);
  }
}
