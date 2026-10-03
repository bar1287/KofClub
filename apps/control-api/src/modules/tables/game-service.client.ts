import { Inject, Injectable, Logger } from '@nestjs/common';
import { isErrorCode } from '@kofclub/contracts';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/config';

interface ErrorEnvelopeLike {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/**
 * Client for the game service's internal API (docs/protocols/
 * internal-game-api.md). Authenticated with the shared service token. When
 * the contacted node does not own the table it answers TABLE_UNAVAILABLE
 * with the owner's URL; the client retries once against that node.
 */
@Injectable()
export class GameServiceClient {
  private readonly logger = new Logger(GameServiceClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  post<T>(tableId: string, action: string, body: unknown, requestId: string): Promise<T> {
    return this.request<T>('POST', `/internal/v1/tables/${tableId}/${action}`, body, requestId);
  }

  get<T>(
    tableId: string,
    resource: string,
    query: Record<string, string>,
    requestId: string,
  ): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    return this.request<T>(
      'GET',
      `/internal/v1/tables/${tableId}/${resource}${qs ? `?${qs}` : ''}`,
      undefined,
      requestId,
    );
  }

  /** A participant's own hole cards for a finished hand (any node can serve it). */
  holeCards(handId: string, userId: string, requestId: string): Promise<{ cards: string[] }> {
    const qs = new URLSearchParams({ userId }).toString();
    return this.request(
      'GET',
      `/internal/v1/hands/${handId}/hole-cards?${qs}`,
      undefined,
      requestId,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    requestId: string,
  ): Promise<T> {
    let base = this.config.GAME_SERVICE_URL;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.config.INTERNAL_SERVICE_TOKEN}`,
            'content-type': 'application/json',
            'x-request-id': requestId,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.GAME_SERVICE_TIMEOUT_MS),
        });
      } catch (err) {
        this.logger.error({ err: (err as Error).message, path }, 'game_service_unreachable');
        throw new AppError('TABLE_UNAVAILABLE', 'Game service unavailable; retry shortly');
      }
      const payload = (await res.json().catch(() => ({}))) as T & ErrorEnvelopeLike;
      if (res.ok) return payload;

      const err = payload.error ?? {};
      const ownerUrl = err.details?.ownerUrl;
      if (
        err.code === 'TABLE_UNAVAILABLE' &&
        typeof ownerUrl === 'string' &&
        ownerUrl !== base &&
        attempt === 0
      ) {
        base = ownerUrl; // table lives on another node
        continue;
      }
      if (err.code && isErrorCode(err.code)) {
        throw new AppError(
          err.code,
          err.message ?? 'Game service rejected the request',
          err.details,
          res.status,
        );
      }
      this.logger.error({ status: res.status, path }, 'game_service_error');
      throw new AppError('TABLE_UNAVAILABLE', 'Game service error; retry shortly');
    }
    throw new AppError('TABLE_UNAVAILABLE', 'Table ownership is moving; retry shortly');
  }
}
