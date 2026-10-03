import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { AppError } from '../../common/errors/app-error';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AuthResult, AuthService } from './auth.service';
import {
  LoginInput,
  loginSchema,
  RefreshInput,
  refreshSchema,
  RegisterInput,
  registerSchema,
} from './identity.schemas';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  wantsCookieTransport,
} from './refresh-cookie';

type AuthResponse = Omit<AuthResult, 'refreshToken'> & { refreshToken?: string };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  @RateLimit({ name: 'auth:register:ip', by: 'ip', limit: 10, windowSec: 3600 })
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(await this.auth.register(body, ctx), req, res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit(
    { name: 'auth:login:ip', by: 'ip', limit: 30, windowSec: 300 },
    { name: 'auth:login:account', by: { body: 'login' }, limit: 10, windowSec: 900 },
  )
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(await this.auth.login(body, ctx), req, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ name: 'auth:refresh:ip', by: 'ip', limit: 60, windowSec: 60 })
  async refresh(
    @Body(new ZodPipe(refreshSchema)) body: RefreshInput,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = body.refreshToken ?? readRefreshCookie(req);
    if (!token) throw new AppError('AUTH_REFRESH_INVALID', 'Refresh token missing');
    try {
      return this.respond(await this.auth.refresh(token, ctx), req, res);
    } catch (err) {
      if (wantsCookieTransport(req)) clearRefreshCookie(res, this.config);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth.sessionId);
    clearRefreshCookie(res, this.config);
  }

  private respond(result: AuthResult, req: Request, res: Response): AuthResponse {
    if (!wantsCookieTransport(req)) return result;
    setRefreshCookie(res, this.config, result.refreshToken, result.refreshTokenExpiresAt);
    const { refreshToken: _omit, ...rest } = result;
    return rest;
  }
}
