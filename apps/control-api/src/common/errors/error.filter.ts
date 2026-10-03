import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ErrorCode, ErrorEnvelope } from '@kofclub/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';

function codeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
  }
}

/**
 * Translates every thrown error into the standard error envelope
 * (spec §7.1). Unknown errors become INTERNAL without leaking internals.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('AppErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = String(req.id ?? res.getHeader('x-request-id') ?? '');

    let status: number;
    let code: ErrorCode;
    let message: string;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Request validation failed';
      details = {
        issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForHttpStatus(status);
      message = status === 404 ? 'Route not found' : exception.message;
    } else if (isBodyParserError(exception)) {
      status = exception.status;
      code = 'VALIDATION_FAILED';
      message = 'Malformed request body';
    } else {
      status = 500;
      code = 'INTERNAL';
      message = 'Internal server error';
      this.logger.error(
        { err: exception, requestId },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (status >= 500 && exception instanceof AppError) {
      this.logger.error({ code, requestId, details }, message);
    }

    const body: ErrorEnvelope = { error: { code, message, requestId } };
    if (details !== undefined) body.error.details = details;
    res.status(status).json(body);
  }
}

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'type' in e &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number' &&
    (e as { status: number }).status < 500
  );
}
