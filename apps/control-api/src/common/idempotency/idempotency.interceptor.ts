import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { from, lastValueFrom, Observable, of } from 'rxjs';
import { sha256Hex } from '../crypto';
import { AppError } from '../errors/app-error';
import type { AppRequest } from '../request-context';
import { IdempotencyRepository } from './idempotency.repository';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const STALE_AFTER_SEC = 120;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Makes retried state-changing requests safe: the first response for an
 * (user, Idempotency-Key) pair is stored and replayed for identical
 * retries; a different request body under the same key is rejected.
 * Chip movements additionally carry ledger-level idempotency (ADR-003).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly repo: IdempotencyRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key || !MUTATING.has(req.method) || !req.auth) return next.handle();
    if (!KEY_RE.test(key)) {
      throw new AppError('VALIDATION_FAILED', 'Invalid Idempotency-Key header');
    }
    return from(this.handle(req, res, key, next));
  }

  private async handle(
    req: AppRequest,
    res: Response,
    key: string,
    next: CallHandler,
  ): Promise<unknown> {
    const userId = req.auth!.userId;
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const requestHash = sha256Hex(`${req.method} ${path}\n${JSON.stringify(req.body ?? null)}`);

    let started = await this.repo.begin(userId, key, req.method, path, requestHash);
    if (!started) {
      const existing = await this.repo.find(userId, key);
      if (existing && existing.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was used with a different request',
        );
      }
      if (existing && existing.statusCode !== null) {
        res.status(existing.statusCode);
        res.setHeader('Idempotent-Replayed', 'true');
        return lastValueFrom(of(existing.responseBody));
      }
      if (await this.repo.reclaimStale(userId, key, STALE_AFTER_SEC)) {
        started = await this.repo.begin(userId, key, req.method, path, requestHash);
      }
      if (!started)
        throw new AppError('CONFLICT', 'A request with this Idempotency-Key is in progress');
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.repo.complete(userId, key, res.statusCode, body);
      return body;
    } catch (err) {
      await this.repo.release(userId, key);
      throw err;
    }
  }
}
