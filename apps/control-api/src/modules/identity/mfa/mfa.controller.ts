import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../../common/request-context';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { MfaService, MfaStatusDto, TotpEnrollmentDto } from './mfa.service';

const codeSchema = z.object({ code: z.string().trim().min(6).max(32) }).strict();
type CodeInput = z.infer<typeof codeSchema>;

// Code guessing is bounded per account, also while Redis is down.
const codeRateLimit = {
  name: 'mfa:code:user',
  by: 'user' as const,
  limit: 10,
  windowSec: 900,
  memoryFallback: true,
};

/** Two-factor authentication of the signed-in user (ADR-017). */
@Controller('me/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext): Promise<MfaStatusDto> {
    return this.mfa.status(auth);
  }

  @Post('totp')
  @RateLimit({ name: 'mfa:enroll:user', by: 'user', limit: 10, windowSec: 3600 })
  start(@CurrentAuth() auth: AuthContext): Promise<TotpEnrollmentDto> {
    return this.mfa.startEnrollment(auth);
  }

  @Post('totp/confirm')
  @HttpCode(200)
  @RateLimit(codeRateLimit)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(codeSchema)) body: CodeInput,
    @Ctx() ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.mfa.confirm(auth, body.code, ctx);
  }

  @Post('totp/disable')
  @HttpCode(204)
  @RateLimit(codeRateLimit)
  async disable(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(codeSchema)) body: CodeInput,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.mfa.disable(auth, body.code, ctx);
  }
}
