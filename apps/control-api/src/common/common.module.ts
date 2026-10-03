import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TokenService } from './auth/token.service';
import { IdempotencyRepository } from './idempotency/idempotency.repository';
import { RateLimitService } from './rate-limit/rate-limit.service';
import { RequestContextMiddleware } from './request-context.middleware';

@Global()
@Module({
  providers: [TokenService, RateLimitService, IdempotencyRepository],
  exports: [TokenService, RateLimitService, IdempotencyRepository],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
