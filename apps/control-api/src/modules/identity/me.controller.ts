import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import { AuthContext, CurrentAuth } from '../../common/request-context';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AuthService, SessionDto, UserDto } from './auth.service';

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return this.auth.me(auth.userId);
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
