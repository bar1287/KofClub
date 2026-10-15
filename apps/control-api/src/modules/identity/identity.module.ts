import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { OperatorsCoreModule } from '../operators/operators-core.module';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { MfaController } from './mfa/mfa.controller';
import { MfaRepository } from './mfa/mfa.repository';
import { MfaService } from './mfa/mfa.service';
import { PasswordService } from './password.service';
import { SessionRevocationPublisher } from './session-revocation.publisher';
import { SessionsRepository } from './sessions.repository';
import { TelegramAccountsRepository } from './telegram-accounts.repository';
import { UsersRepository } from './users.repository';

@Module({
  imports: [OperatorsCoreModule],
  controllers: [AuthController, MeController, MfaController],
  providers: [
    AuthService,
    MfaService,
    MfaRepository,
    PasswordService,
    UsersRepository,
    SessionsRepository,
    TelegramAccountsRepository,
    SessionRevocationPublisher,
    // Order matters: authenticate first, then rate-limit by user.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [
    UsersRepository,
    SessionsRepository,
    TelegramAccountsRepository,
    SessionRevocationPublisher,
    MfaService,
  ],
})
export class IdentityModule {}
