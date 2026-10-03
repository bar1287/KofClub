import type { AuthResult, ErrorBody, User } from '../types';
import { joinUrl } from '../env';

/** A machine-readable API failure (branch on `code`, never on `message`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Codes meaning "the access token is unusable; refresh and retry once". */
const RETRY_AFTER_REFRESH = new Set(['AUTH_REQUIRED', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID']);

/** Refresh this long before the access token expires. */
const EXPIRY_SKEW_MS = 30_000;

export interface AuthState {
  user: User | null;
  sessionId: string | null;
}

export interface RequestOptions {
  body?: unknown;
  /** Makes a retried state-changing request a no-op (Idempotency-Key header). */
  idempotencyKey?: string;
  /** false for public endpoints (no bearer token, no refresh). */
  auth?: boolean;
  signal?: AbortSignal;
}

interface LockManagerLike {
  request<T>(name: string, cb: () => Promise<T>): Promise<T>;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Cross-tab mutex for refresh-token rotation (navigator.locks in browsers). */
  locks?: LockManagerLike | null;
  now?: () => number;
}

/**
 * HTTP client for the control API.
 *
 * Browser token model (docs/security.md): the access token lives only in
 * memory; the refresh token is an HttpOnly SameSite=Strict cookie scoped to
 * /v1/auth (requested with `X-Auth-Transport: cookie`), so injected scripts
 * cannot read it. Refresh tokens rotate on every use and a reused token
 * revokes the session, so refreshes are single-flight within a tab and
 * serialized across tabs with the Web Locks API.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly locks: LockManagerLike | null;
  private readonly now: () => number;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private state: AuthState = { user: null, sessionId: null };
  private refreshing: Promise<AuthResult> | null = null;
  private readonly listeners = new Set<(s: AuthState) => void>();

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.locks = opts.locks ?? null;
    this.now = opts.now ?? Date.now;
  }

  get auth(): AuthState {
    return this.state;
  }

  onAuthChange(listener: (s: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Installs tokens from a login/register/refresh response. */
  setSession(result: AuthResult): void {
    this.accessToken = result.accessToken;
    this.expiresAt = Date.parse(result.accessTokenExpiresAt);
    this.state = { user: result.user, sessionId: result.sessionId };
    this.emit();
  }

  /** Forgets the in-memory session (the cookie is cleared by logout). */
  clearSession(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    if (this.state.user !== null) {
      this.state = { user: null, sessionId: null };
      this.emit();
    }
  }

  /** Returns a valid access token, refreshing it when it is about to expire. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.expiresAt - EXPIRY_SKEW_MS > this.now()) {
      return this.accessToken;
    }
    const result = await this.refresh();
    return result.accessToken;
  }

  /** Expiry of the current access token (ms since epoch, 0 if none). */
  get accessTokenExpiresAt(): number {
    return this.expiresAt;
  }

  /**
   * Rotates the refresh cookie and installs a fresh access token.
   * Concurrent callers share one request.
   */
  refresh(): Promise<AuthResult> {
    if (!this.refreshing) {
      const run = () =>
        this.send<AuthResult>('POST', '/v1/auth/refresh', { auth: false, body: {} }, true);
      const locked = this.locks ? this.locks.request('kofclub-auth-refresh', run) : run();
      this.refreshing = locked
        .then((result) => {
          this.setSession(result);
          return result;
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) this.clearSession();
          throw err;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  /** Restores the session from the refresh cookie (page load). */
  async restore(): Promise<User | null> {
    try {
      return (await this.refresh()).user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  async register(input: { email: string; username: string; password: string }): Promise<User> {
    const result = await this.send<AuthResult>(
      'POST',
      '/v1/auth/register',
      { auth: false, body: input },
      true,
    );
    this.setSession(result);
    return result.user;
  }

  async login(input: { login: string; password: string }): Promise<User> {
    const result = await this.send<AuthResult>(
      'POST',
      '/v1/auth/login',
      { auth: false, body: input },
      true,
    );
    this.setSession(result);
    return result.user;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('POST', '/v1/auth/logout');
    } finally {
      this.clearSession();
    }
  }

  /** Authenticated request; refreshes and retries once on an expired token. */
  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    if (opts.auth === false) return this.send<T>(method, path, opts, false);
    await this.getAccessToken();
    try {
      return await this.send<T>(method, path, opts, false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || !RETRY_AFTER_REFRESH.has(err.code)) {
        throw err;
      }
      await this.refresh();
      return this.send<T>(method, path, opts, false);
    }
  }

  private async send<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    cookieTransport: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (cookieTransport) headers['X-Auth-Transport'] = 'cookie';
    if (opts.auth !== false && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // The refresh cookie is path-scoped to /v1/auth; other calls carry none.
        credentials: 'include',
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiError(0, 'SERVICE_UNAVAILABLE', 'The server could not be reached.');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const body = (data as { error?: ErrorBody } | undefined)?.error;
      throw new ApiError(
        res.status,
        body?.code ?? (res.status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
        body?.message ?? `Request failed (${res.status})`,
        body?.details,
        body?.requestId,
      );
    }
    return data as T;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A fresh idempotency key for one user intent (reuse it when retrying). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** User-facing message for an error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
