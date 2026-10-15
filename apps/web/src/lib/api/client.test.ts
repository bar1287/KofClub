import type { User } from '../types';
import { ApiClient, ApiError } from './client';

const user: User = {
  id: '0191a000-0000-7000-8000-00000000000a',
  email: 'a@example.com',
  username: 'alice',
  status: 'ACTIVE',
  platformRole: 'USER',
  createdAt: '2026-01-01T00:00:00Z',
  hasPassword: true,
  telegram: null,
};

function authResult(token: string, expiresInMs = 900_000, refreshToken?: string) {
  return {
    user,
    sessionId: '0191a000-0000-7000-8000-0000000000s1',
    accessToken: token,
    accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('shares one refresh between concurrent callers and uses cookie transport', async () => {
    let refreshes = 0;
    const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://api/v1/auth/refresh');
      expect((init.headers as Record<string, string>)['X-Auth-Transport']).toBe('cookie');
      expect(init.credentials).toBe('include');
      refreshes++;
      return json(200, authResult(`t${refreshes}`));
    });
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const [a, b] = await Promise.all([api.getAccessToken(), api.getAccessToken()]);
    expect(a).toBe('t1');
    expect(b).toBe('t1');
    expect(refreshes).toBe(1);
    expect(api.auth.user?.username).toBe('alice');
    // Cached until it nears expiry.
    expect(await api.getAccessToken()).toBe('t1');
  });

  it('refreshes once and retries a request rejected with an expired token', async () => {
    const calls: string[] = [];
    const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      calls.push(`${url} ${auth ?? ''}`);
      if (url.endsWith('/v1/auth/refresh')) return json(200, authResult('fresh'));
      if (auth === 'Bearer stale') {
        return json(401, {
          error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired', requestId: 'r1' },
        });
      }
      return json(200, { items: [] });
    });
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    api.setSession(authResult('stale'));
    await expect(api.request('GET', '/v1/clubs')).resolves.toEqual({ items: [] });
    expect(calls).toEqual([
      'http://api/v1/clubs Bearer stale',
      'http://api/v1/auth/refresh ',
      'http://api/v1/clubs Bearer fresh',
    ]);
  });

  it('surfaces the error envelope and clears the session when refresh fails', async () => {
    const fetchMock = jest.fn(async () =>
      json(401, { error: { code: 'AUTH_REFRESH_REUSED', message: 'reused', requestId: 'r2' } }),
    );
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const changes: unknown[] = [];
    api.onAuthChange((s) => changes.push(s.user));
    api.setSession(authResult('x', -1));
    const err = await api.request('GET', '/v1/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'AUTH_REFRESH_REUSED', requestId: 'r2' });
    expect(api.auth.user).toBeNull();
    expect(changes).toEqual([user, null]);
    await expect(api.restore()).resolves.toBeNull();
  });

  it('sends idempotency keys and maps network failures', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-12345');
        return new Response(null, { status: 204 });
      })
      .mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    api.setSession(authResult('t'));
    await expect(
      api.request('POST', '/v1/x', { body: {}, idempotencyKey: 'key-12345' }),
    ).resolves.toBeUndefined();
    await expect(api.request('GET', '/v1/y')).rejects.toMatchObject({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('keeps the refresh token in memory inside Telegram and rotates it', async () => {
    const sent: { url: string; transport?: string; body: unknown }[] = [];
    let n = 0;
    const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url,
        transport: (init.headers as Record<string, string>)['X-Auth-Transport'],
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (url.endsWith('/v1/me/telegram')) {
        return json(200, { ...user, telegram: { username: 'al', firstName: 'Al', linkedAt: 'x' } });
      }
      n++;
      return json(200, authResult(`t${n}`, -1, `rt_${n}`));
    });
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      refreshInMemory: true,
    });
    await api.loginWithTelegram({ initData: 'signed' });
    // The access token is already expired: the next call refreshes with the body token.
    await api.getAccessToken();
    await api.getAccessToken();
    expect(sent.map((s) => [s.url, s.transport, s.body])).toEqual([
      ['http://api/v1/auth/telegram', undefined, { initData: 'signed' }],
      ['http://api/v1/auth/refresh', undefined, { refreshToken: 'rt_1' }],
      ['http://api/v1/auth/refresh', undefined, { refreshToken: 'rt_2' }],
    ]);
    // Linking keeps the session and updates the user.
    api.setSession(authResult('fresh', 900_000, 'rt_9'));
    await api.linkTelegram('signed');
    expect(api.auth.user?.telegram?.username).toBe('al');

    // Without a token in memory nothing is sent.
    api.clearSession();
    sent.length = 0;
    await expect(api.restore()).resolves.toBeNull();
    expect(sent).toEqual([]);
  });
});
