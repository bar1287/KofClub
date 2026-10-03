import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { PasswordService } from './password.service';
import { SessionRevocationPublisher } from './session-revocation.publisher';
import { SessionsRepository } from './sessions.repository';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    UsersRepository,
    SessionsRepository,
    SessionRevocationPublisher,
    // Order matters: authenticate first, then rate-limit by user.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [UsersRepository, SessionsRepository, SessionRevocationPublisher],
})
export class IdentityModule {}
